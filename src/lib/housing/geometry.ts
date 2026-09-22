/**
 * Turning square metres into something that can be built.
 *
 * A pen is not an area, it is a rectangle, and the two are not interchangeable:
 * 13 m² is a finishing pen at 3.25 by 4.0 and a corridor at 1.0 by 13.0. So the
 * planner never reports floor area on its own. It searches a grid of practical
 * widths, takes the length that covers the area at that width, and scores what
 * it gets on the two things that actually matter — how much floor is being paid
 * for and not used, and how far off a sensible shape the box is.
 *
 * Nothing here is hard-coded to a dimension. A pen that comes out 3.25 by 4.00
 * comes out that way because that candidate scored best against the required
 * area and the preferred proportion, and the same search run against a different
 * policy gives a different box.
 */

/** Pens are built to the quarter metre; nobody sets out a wall to the centimetre. */
export const DIMENSION_STEP_M = 0.25;

/** A square metre bought and not used is worth this much against the shape. */
const AREA_WEIGHT = 1;
/** And this is what being the wrong shape is worth against the wasted floor. */
const RATIO_WEIGHT = 2;

export type Rectangle = {
  widthM: number;
  lengthM: number;
  areaM2: number;
};

export type RectangleRequest = {
  /** The floor the animals in it must have. The box is never smaller than this. */
  requiredAreaM2: number;
  /** The proportion the search aims at: 1 is square. */
  preferredAspectRatio: number;
  minWidthM?: number;
  maxWidthM?: number;
  minLengthM?: number;
  maxLengthM?: number;
  /**
   * A hard constraint from the housing rules rather than a preference — the
   * manual will not have a service pen narrower than 2.1 m however neatly the
   * area works out.
   */
  minShortSideM?: number;
  stepM?: number;
};

/**
 * Two decimals for a side, because a plan that prints 4.050000000000001 is not
 * a plan, and four for an area — a quarter-metre by a quarter-metre lands on
 * sixteenths, and a reader who multiplies the two sides printed beside it has to
 * get the area printed under it.
 */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function roundArea(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

/** The next whole step at or above a measurement. */
export function ceilToStep(value: number, step = DIMENSION_STEP_M): number {
  if (step <= 0) return round2(value);
  return round2(Math.ceil(value / step - 1e-9) * step);
}

/** How far from square a box is: 1 is square, 2 is twice as long as it is wide. */
export function aspectRatioOf(widthM: number, lengthM: number): number {
  const shortest = Math.min(widthM, lengthM);
  if (shortest <= 0) return Number.POSITIVE_INFINITY;
  return Math.max(widthM, lengthM) / shortest;
}

/**
 * Every width worth trying: the grid between the bounds, plus the bounds
 * themselves.
 *
 * The bounds go in whether or not they sit on the grid, because a manual
 * dimension of 1.8 m is a real constraint and a quarter-metre grid has no 1.8 in
 * it. Rounding it away would quietly report a farrowing pen 0.05 m wider than
 * the standard it claims to come from.
 */
function candidateWidths(request: RectangleRequest, step: number): number[] {
  const floor = Math.max(request.minWidthM ?? step, request.minShortSideM ?? 0, step);
  // Above the square root the box is wider than it is long, which is the same
  // rectangle the other way round. There is nothing there the search has not
  // already looked at.
  const square = Math.sqrt(Math.max(request.requiredAreaM2, 0));
  const ceiling = Math.min(request.maxWidthM ?? Number.POSITIVE_INFINITY, Math.max(square, floor));

  const widths = new Set<number>();
  if (floor <= ceiling) widths.add(round2(floor));
  for (let width = ceilToStep(floor, step); width <= ceiling + 1e-9; width = round2(width + step)) {
    widths.add(round2(width));
  }
  if (request.maxWidthM !== undefined && request.maxWidthM <= ceiling + 1e-9) {
    widths.add(round2(request.maxWidthM));
  }
  return [...widths].sort((a, b) => a - b);
}

/**
 * The best rectangle for a required floor area, or null when the constraints
 * cannot all be met at once.
 *
 * Null is a real answer and not a failure to try: a policy that asks for 9.3 m²
 * with no side under 2.1 m and no side over 2.0 m is asking for a box that does
 * not exist, and the planner should say so rather than round one of the rules
 * away.
 */
export function rectangleFor(request: RectangleRequest): Rectangle | null {
  const step = request.stepM ?? DIMENSION_STEP_M;
  let best: Rectangle | null = null;
  let bestScore = Number.POSITIVE_INFINITY;

  for (const widthM of candidateWidths(request, step)) {
    let lengthM = ceilToStep(request.requiredAreaM2 / widthM, step);
    if (request.minLengthM !== undefined) lengthM = Math.max(lengthM, round2(request.minLengthM));
    if (request.maxLengthM !== undefined && lengthM > request.maxLengthM + 1e-9) continue;
    if (request.minShortSideM !== undefined) {
      if (Math.min(widthM, lengthM) < request.minShortSideM - 1e-9) continue;
    }
    const areaM2 = roundArea(widthM * lengthM);
    if (areaM2 < request.requiredAreaM2 - 1e-9) continue;

    const wasted = areaM2 - request.requiredAreaM2;
    const ratio = aspectRatioOf(widthM, lengthM);
    const score =
      wasted * AREA_WEIGHT + Math.abs(ratio - request.preferredAspectRatio) * RATIO_WEIGHT;
    // Ties go to the narrower box, which is the one already reached, so the same
    // request always produces the same pen.
    if (score < bestScore - 1e-9) {
      best = { widthM, lengthM, areaM2 };
      bestScore = score;
    }
  }

  return best;
}

/**
 * A room holding a row of pens along a service passage.
 *
 * ```text
 * ┌──────┬──────┬──────┬──────┐
 * │ Pen  │ Pen  │ Pen  │ Pen  │
 * ├──────┴──────┴──────┴──────┤
 * │      service passage      │
 * └───────────────────────────┘
 * ```
 *
 * The pens stand shoulder to shoulder with their narrow side to the passage,
 * which is how a pig house is set out: the frontage is what a stockperson walks
 * past and the depth is what the pigs lie in.
 */
export function singleRowRoom(pen: Rectangle, pensPerRoom: number, passageM: number): Rectangle {
  const lengthM = round2(pensPerRoom * pen.widthM);
  const widthM = round2(pen.lengthM + passageM);
  return { widthM, lengthM, areaM2: roundArea(widthM * lengthM) };
}

/**
 * A room with two rows of pens facing each other across one passage.
 *
 * ```text
 * ┌──────┬──────┐
 * │ Pen  │ Pen  │
 * ├──────┴──────┤
 * │   passage   │
 * ├──────┬──────┤
 * │ Pen  │ Pen  │
 * └──────┴──────┘
 * ```
 *
 * One passage serves twice the pens, so the same number of pens comes out
 * shorter and squarer. Only ever drawn for an even number of pens: a row with a
 * gap in it is not a room anybody builds.
 */
export function doubleRowRoom(pen: Rectangle, pensPerRoom: number, passageM: number): Rectangle {
  const perSide = pensPerRoom / 2;
  const lengthM = round2(perSide * pen.widthM);
  const widthM = round2(pen.lengthM * 2 + passageM);
  return { widthM, lengthM, areaM2: roundArea(widthM * lengthM) };
}

/** Rooms end to end down one axis: the whole building's footprint. */
export function buildingRectangle(rooms: readonly Rectangle[]): Rectangle {
  if (rooms.length === 0) return { widthM: 0, lengthM: 0, areaM2: 0 };
  // Laid out along their length and squared off across their width, which is
  // the footprint a site plan would have to reserve. Rooms of one type are all
  // the same size, so for every building but the shared breeding house this is
  // exactly the rooms and nothing else.
  const lengthM = round2(rooms.reduce((total, room) => total + room.lengthM, 0));
  const widthM = round2(Math.max(...rooms.map((room) => room.widthM)));
  return { widthM, lengthM, areaM2: roundArea(widthM * lengthM) };
}
