
let phaseAnimation = 0;

function setup() {
  createCanvas(400, 400);
  noStroke();
}

function draw() {
  background(10);
  phaseAnimation += 0.01;
  phaseAnimation = phaseAnimation % 30;
  //drawMoon_2D(phaseAnimation, height / 2);
  drawMoon_2D(phaseAnimation, height / 2);
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

