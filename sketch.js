let color1 = [0, 0, 0]; // Black
let color2 = [255, 255, 255]; // White
let frame = 0;

function setup() {
  createCanvas(400, 400);
}

function draw() {
  background(220);
  frame++;
  if (frame % 2 == 0) {
    drawTarget(width / 2, height / 2, 80, 20, color1, color2);
  } else {
    drawTarget(width / 2, height / 2, 80, 20, color2, color1);
  }
}

function drawTarget(x, y, rings = 8, spacing = width / 20, col1, col2) {
  // Draw from out to inner so small circles on top
  for (let i = rings; i > 0; i--) {
    if (i % 2 === 0) 
      fill(col2); 
    else fill(col1);

    let radius = i * spacing;
    ellipse(x, y, radius * 2, radius * 2);
  }
}