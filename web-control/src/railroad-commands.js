function buildStopAllTrainCommands(layout, state) {
  return layout.trains.map((train) => {
    const live = state?.trains?.[String(train.address)];
    const direction = live?.direction === "reverse" ? 0 : 1;
    return `<t ${train.address} 0 ${direction}>`;
  });
}

module.exports = { buildStopAllTrainCommands };
