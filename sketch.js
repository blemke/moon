

let phaseAnimation = 0;
let moonTexture;
// desired apparent angular radius (radians) of the Moon as seen by the observer
let moonAngularRadius = 0.02;
let earthRadius = 80;
// Increase moon orbit so the Moon appears distant relative to Earth
let moonOrbit = 40000;
// runtime toggles
let surfaceObserver = true; // default: standing on Earth
let showEarth = true;
// Earth rotation state (radians)
let earthRotation = 0;
let earthRotationSpeed = 0.002; // radians per frame (adjust for faster/slower day)

function setup() {
  createCanvas(900, 500, WEBGL);
  moonTexture = createGraphics(256, 256);
  moonTexture.pixelDensity(1);
  noStroke();
  // use a wider perspective and small near plane to avoid clipping when camera is near geometry
  perspective(PI / 3, width / height, 0.1, 200000);
}

function draw() {
  background(5);
  // place the camera at an Earth-surface observer and look at the moon
  // observer sits just outside Earth's radius on the +X equator, slightly above surface to avoid clipping
  phaseAnimation += 0.12; // drives moon position / phase
  phaseAnimation = phaseAnimation % 30;
  let phaseAngle = map(phaseAnimation, 0, 30, 0, TWO_PI);

  // Scene geometry
  let sunPos = createVector(-1200, -300, 400);
  let earthPos = createVector(0, 0, 0);
  // place the Moon on a distant celestial sphere with a small inclination
  let lon = phaseAngle;
  let lat = radians(18); // small inclination so Moon moves across sky vertically
  let moonDir = createVector(cos(lat) * cos(lon), sin(lat), cos(lat) * sin(lon));
  let moonPos = moonDir.copy().mult(moonOrbit);

  // Update Earth's rotation
  earthRotation += earthRotationSpeed;

  // Camera: compute observer position attached to Earth rotation when surfaceObserver
  let observer;
  if (surfaceObserver) {
    // observer longitude follows Earth's rotation; place at equator (y=0)
    let obsAngle = earthRotation; // can add an offset if desired
    observer = createVector((earthRadius + 6) * cos(obsAngle), 0, (earthRadius + 6) * sin(obsAngle));
  } else {
    observer = createVector((earthRadius + 6) * 2.0, 0, -200);
  }

  // local up vector for the observer (points away from Earth's center)
  let localUp = observer.copy().normalize();
  // point camera toward local zenith so sky objects (sun/moon) move across view
  let camTarget = p5.Vector.add(observer, p5.Vector.mult(localUp, 2000));
  camera(observer.x, observer.y, observer.z, camTarget.x, camTarget.y, camTarget.z, 0, 1, 0);

  // Calculate illumination/phase from true geometry: angle between moon->sun and moon->observer
  let moonToSun = p5.Vector.sub(sunPos, moonPos).normalize();
  let moonToObserver = p5.Vector.sub(observer, moonPos).normalize();
  // dot = 1 when full (sun behind observer), -1 when new moon
  let phaseDot = moonToSun.dot(moonToObserver);

  // Use directional light from sun position for realistic shading
  let sunDir = p5.Vector.sub(sunPos, moonPos).normalize();
  directionalLight(255, 255, 220, sunDir.x, sunDir.y, sunDir.z);
  ambientLight(20);

  // Create a neutral moon albedo texture (no phase baked in)
  updateMoonTexture(moonTexture);

  // Lighting
  ambientLight(30);
  pointLight(255, 255, 220, sunPos.x, sunPos.y, sunPos.z);

  // Only draw a globe representation of Earth when the camera is not inside/too-close to it
  // compute occlusion: if the line from observer to moon intersects Earth's sphere, don't draw the globe
  let occluded = lineIntersectsSphere(observer, moonPos, earthPos, earthRadius * 0.98);
  if (showEarth && observer.mag() > earthRadius * 1.4 && !occluded) {
    push();
    translate(earthPos.x, earthPos.y, earthPos.z);
    // rotate Earth so surface features move under the camera
    rotateY(earthRotation);
    ambientMaterial(60, 120, 200);
    sphere(earthRadius, 48, 48);
    pop();

    // small marker to show observer location on Earth's surface (for debugging) - rotates with Earth
    push();
    rotateY(earthRotation);
    translate((earthRadius) * 0.98, 0, 0);
    ambientMaterial(255, 80, 80);
    sphere(4);
    pop();
  } else {
    // draw a small horizon indicator instead of full Earth to avoid occluding the sky
    push();
    translate(observer.x * 0.6, observer.y * 0.6, observer.z * 0.6);
    ambientMaterial(30, 90, 40);
    sphere(12);
    pop();
  }

  // Determine if Moon is above local horizon (for surface observers)
  let moonVisible = true;
  if (surfaceObserver) {
    let localUp = observer.copy().normalize();
    let moonFromObserver = p5.Vector.sub(moonPos, observer).normalize();
    // above horizon when dot > 0
    moonVisible = moonFromObserver.dot(localUp) > 0;
  }

  // Draw Moon with texture; compute world radius so apparent angular size stays constant
  let distObsMoon = p5.Vector.dist(observer, moonPos);
  let moonRadiusWorld = tan(moonAngularRadius) * distObsMoon;
  push();
  translate(moonPos.x, moonPos.y, moonPos.z);
  // Make the Moon tidally locked to Earth: rotate so the same lunar face points toward Earth's center
  let angleToEarth = atan2(earthPos.z - moonPos.z, earthPos.x - moonPos.x);
  // rotateY so the texture 'front' faces Earth. sign may be adjusted if texture appears mirrored.
  rotateY(-angleToEarth);
  if (!moonVisible) {
    // dim or hide the Moon when below horizon
    ambientMaterial(40);
    sphere(moonRadiusWorld * 0.9, 32, 32);
  } else {
    texture(moonTexture);
    shininess(5);
    sphere(moonRadiusWorld, 64, 64);
  }
  pop();

  // Draw Sun as emissive indicator
  push();
  translate(sunPos.x, sunPos.y, sunPos.z);
  emissiveMaterial(255, 200, 40);
  sphere(20);
  pop();
}



function updateMoonTexture(g) {
  g.clear();
  g.noStroke();
  let w = g.width;
  let h = g.height;
  // base moon color
  g.background(30);
  g.fill(200);
  g.ellipse(w / 2, h / 2, w * 0.92, h * 0.92);

  // add simple crater noise for surface detail (non-directional)
  g.fill(170, 180);
  for (let i = 0; i < 120; i++) {
    let rx = random(w * 0.2, w * 0.8);
    let ry = random(h * 0.2, h * 0.8);
    let rr = random(2, 8);
    g.ellipse(rx, ry, rr, rr * random(0.6, 1.2));
  }
}

// Returns true if the segment from p0 (observer) to p1 (moon) intersects the sphere (center, radius)
function lineIntersectsSphere(p0, p1, center, radius) {
  // move to sphere-local coordinates
  let o = p5.Vector.sub(p0, center);
  let d = p5.Vector.sub(p1, p0);
  let a = d.dot(d);
  let b = 2 * o.dot(d);
  let c = o.dot(o) - radius * radius;
  let disc = b * b - 4 * a * c;
  if (disc < 0) return false;
  let sq = sqrt(disc);
  let t1 = (-b - sq) / (2 * a);
  let t2 = (-b + sq) / (2 * a);
  // Intersection occurs between observer and moon if t in (0,1)
  if ((t1 > 0 && t1 < 1) || (t2 > 0 && t2 < 1)) return true;
  return false;
}


function drawMoon_3D(phase, h) {
  // kept for compatibility: delegate to main draw logic
}

function drawMoon_2D(phase, h) {
  let d = 50;
  let xloc = map(phase, 0, 30, 50, width - 50);
  push();
  translate(xloc, h);
  fill(255);
  ellipse(0, 0, d, d);
  fill(0);
  let offset = map(phase, 0, 30, -d, d);
  ellipse(offset, 0, d, d);
  pop();
}

function keyPressed() {
  if (key === 'o' || key === 'O') {
    surfaceObserver = !surfaceObserver;
  }
  if (key === 'g' || key === 'G') {
    showEarth = !showEarth;
  }
}

