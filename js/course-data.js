// Wraps mt-paul-course-data.json (fetched at runtime) into a small, easy-to-use
// API for the rest of the app. Fetching (rather than a hardcoded JS copy) keeps
// this file the single place that knows the course-data.json shape.
//
// NOTE: because this uses fetch() + ES modules, the app must be served over
// http(s) (e.g. `python3 -m http.server`), not opened via file://.

let _cache = null;

// Loads (and caches) the raw course-data.json.
export async function loadCourseData() {
  if (_cache) return _cache;
  const res = await fetch('./mt-paul-course-data.json');
  if (!res.ok) throw new Error('Failed to load mt-paul-course-data.json: ' + res.status);
  _cache = await res.json();
  return _cache;
}

// Returns an 18-length array of { holeNum, par, yardage, index } for the given
// tee ('blue' | 'red'), holeNum 1-18, pulled straight from the course JSON's
// male tees list (this course has no separate female tee data yet).
export function getHolesForTee(courseData, tee) {
  const teeName = tee === 'red' ? 'Red' : 'Blue';
  const teeData = (courseData.tees.male || []).find((t) => t.tee_name === teeName);
  if (!teeData) throw new Error('Tee not found in course data: ' + tee);
  return teeData.holes.map((h, i) => ({
    holeNum: i + 1,
    par: h.par,
    yardage: h.yardage,
    index: h.index
  }));
}

// Convenience: par for a single hole number (1-18) on a given tee.
export function getPar(courseData, tee, holeNum) {
  const holes = getHolesForTee(courseData, tee);
  const hole = holes.find((h) => h.holeNum === holeNum);
  return hole ? hole.par : null;
}

// Course-level metadata needed for handicap-related calcs later (Pass 2+).
export function getTeeMeta(courseData, tee) {
  const teeName = tee === 'red' ? 'Red' : 'Blue';
  const teeData = (courseData.tees.male || []).find((t) => t.tee_name === teeName);
  if (!teeData) return null;
  return {
    teeName: teeData.tee_name,
    courseRating: teeData.course_rating,
    slopeRating: teeData.slope_rating,
    parTotal: teeData.par_total,
    totalYards: teeData.total_yards
  };
}
