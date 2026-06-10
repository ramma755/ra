const history = [];
const maxPoints = 60;

const chart = d3.select("#chart");
const width = 820;
const height = 360;
const margin = { top: 28, right: 48, bottom: 42, left: 58 };

const altitudeLine = d3
  .line()
  .x((datum) => xScale(datum.mission_time))
  .y((datum) => altitudeScale(datum.altitude_km));

const velocityLine = d3
  .line()
  .x((datum) => xScale(datum.mission_time))
  .y((datum) => velocityScale(datum.velocity_mps));

const xScale = d3.scaleLinear().range([margin.left, width - margin.right]);
const altitudeScale = d3.scaleLinear().range([height - margin.bottom, margin.top]);
const velocityScale = d3.scaleLinear().range([height - margin.bottom, margin.top]);

chart.append("g").attr("class", "axis x-axis");
chart.append("g").attr("class", "axis y-axis");
chart.append("path").attr("class", "altitude");
chart.append("path").attr("class", "velocity");

chart
  .append("text")
  .attr("x", margin.left)
  .attr("y", 22)
  .attr("fill", "#6ee7f9")
  .text("Altitude km");

chart
  .append("text")
  .attr("x", width - 150)
  .attr("y", 22)
  .attr("fill", "#fbbf24")
  .text("Velocity m/s");

function updateCards(frame) {
  document.querySelector("#phase").textContent = frame.phase;
  document.querySelector("#fuel").textContent = `${frame.fuel_percent}%`;
  document.querySelector("#temperature").textContent = `${frame.engine_temp_c} C`;
  document.querySelector("#acceleration").textContent = `${frame.acceleration_g} g`;
}

function drawChart() {
  xScale.domain(d3.extent(history, (datum) => datum.mission_time));
  altitudeScale.domain([0, d3.max(history, (datum) => datum.altitude_km) || 1]);
  velocityScale.domain([0, d3.max(history, (datum) => datum.velocity_mps) || 1]);

  chart
    .select(".x-axis")
    .attr("transform", `translate(0, ${height - margin.bottom})`)
    .call(d3.axisBottom(xScale));

  chart
    .select(".y-axis")
    .attr("transform", `translate(${margin.left}, 0)`)
    .call(d3.axisLeft(altitudeScale));

  chart
    .select(".altitude")
    .datum(history)
    .attr("fill", "none")
    .attr("stroke", "#6ee7f9")
    .attr("stroke-width", 3)
    .attr("d", altitudeLine);

  chart
    .select(".velocity")
    .datum(history)
    .attr("fill", "none")
    .attr("stroke", "#fbbf24")
    .attr("stroke-width", 3)
    .attr("d", velocityLine);
}

function appendFrame(frame) {
  history.push(frame);

  if (history.length > maxPoints) {
    history.shift();
  }

  updateCards(frame);
  drawChart();
}

async function loadSnapshot() {
  const response = await fetch("/api/snapshot");
  const payload = await response.json();
  payload.data.forEach(appendFrame);
}

function connectStream() {
  const scheme = window.location.protocol === "https:" ? "wss" : "ws";
  const socket = new WebSocket(`${scheme}://${window.location.host}/ws/telemetry`);

  socket.addEventListener("open", () => {
    document.querySelector("#connection").textContent = "streaming";
  });

  socket.addEventListener("message", (event) => {
    appendFrame(JSON.parse(event.data));
  });

  socket.addEventListener("close", () => {
    document.querySelector("#connection").textContent = "reconnecting";
    setTimeout(connectStream, 1500);
  });
}

loadSnapshot().then(connectStream);
