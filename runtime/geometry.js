// The editor's screen-to-layer geometry while motion is on. Motion animates the live layer elements with the Web Animations API (individual `translate`,
// `rotate` and `scale`), so where a layer VISIBLY is can differ from where the Paper's model puts it, while the model stays exactly as authored. An edit gesture
// must turn a pointer displacement into the change of the model value that makes the layer follow the pointer on screen: that is the inverse of the linear part
// of every animated ancestor between the edited value and the screen. Everything here is plain arithmetic on 2x2 matrices [a, b, c, d] (x' = a*x + c*y,
// y' = b*x + d*y); nothing reads the page. With no animated ancestor the result is the canonical diagram scale alone, exactly as before.
export const IDENTITY = [1, 0, 0, 1];
export const mul = (m, n) => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3]];
export const apply = (m, x, y) => ({x: m[0] * x + m[2] * y, y: m[1] * x + m[3] * y});
export const isIdentity = (m, epsilon = 1e-9) => Math.abs(m[0] - 1) < epsilon && Math.abs(m[1]) < epsilon && Math.abs(m[2]) < epsilon && Math.abs(m[3] - 1) < epsilon;
// null when the map flattens the plane (a scale of 0): there is no way back from it, and the caller falls back to the canonical scale.
export function invert(m) {
  const det = m[0] * m[3] - m[1] * m[2];
  return Number.isFinite(det) && Math.abs(det) > 1e-9 ? [m[3] / det, -m[1] / det, -m[2] / det, m[0] / det] : null;
}
const NUMBER = '[-+]?(?:\\d+\\.?\\d*|\\.\\d+)(?:e[-+]?\\d+)?';
const ANGLE = new RegExp(`^(?:z\\s+)?(${NUMBER})(deg|rad|grad|turn)?$`, 'i');
const toDegrees = (value, unit = 'deg') => value * ({deg: 1, rad: 180 / Math.PI, grad: 0.9, turn: 360}[unit.toLowerCase()] ?? 1);
const numbers = text => (String(text).match(new RegExp(NUMBER, 'gi')) || []).map(Number);
// The computed values of the individual transform properties the motion runtime sets on an element ('none' when it sets none): the translation (design px),
// and the linear part R(rotate) * S(scale), in the order the browser applies them (translate, rotate, scale about the element's origin, then its own transform).
export function parsePose({translate = 'none', rotate = 'none', scale = 'none'} = {}) {
  let angle = 0;
  if (rotate && rotate !== 'none') { const match = ANGLE.exec(String(rotate).trim()); if (match) angle = toDegrees(Number(match[1]), match[2]); }
  const factors = scale && scale !== 'none' ? numbers(scale) : [], sx = factors.length ? factors[0] : 1, sy = factors.length > 1 ? factors[1] : sx;
  const t = translate && translate !== 'none' ? numbers(translate) : [], radians = angle * Math.PI / 180, cos = Math.cos(radians), sin = Math.sin(radians);
  return {tx: t[0] || 0, ty: t[1] || 0, linear: [cos * sx, sin * sx, -sin * sy, cos * sy]};
}
// The linear map from an element's CHILDREN's local coordinates (design units) up to the coordinates of the chain's top, for ancestors listed nearest first.
// Each ancestor contributes its canonical diagram scale (the symbol content is scaled to its box) and then its own animated pose.
export function chainBasis(ancestors) {
  let basis = IDENTITY, posed = false;
  for (const {pose = IDENTITY, sx = 1, sy = 1} of ancestors) { if (!isIdentity(pose)) posed = true; basis = mul(mul(pose, [sx, 0, 0, sy]), basis); }
  return {linear: basis, inverse: posed ? invert(basis) : null, posed};
}
// Resize of the animated element itself: the origin of its own box is its top-left, so only its linear part matters for a size change.
export const poseBasis = pose => ({linear: pose, inverse: isIdentity(pose) ? null : invert(pose), posed: !isIdentity(pose)});
