const layout = {
  automation: {
    startRoute: 100,
    gracefulStopRoute: 110
  },
  turnouts: [
    { id: 1, label: "PDL Double Turnout" },
    { id: 2, label: "PDL Left Turnout" },
    { id: 3, label: "PDL Right Turnout" }
  ],
  trains: [
    { address: 1, label: "Broadway Limited Imports Reading T1" },
    { address: 2, label: "KATO Shinkansen N700s" },
    { address: 4, label: "KATO E233" },
    { address: 5, label: "KATO EMD F7" },
    { address: 6, label: "KATO EMD SD90" },
    { address: 7, label: "KATO Union Pacific FEF-3" }
  ],
  sensors: [
    { id: 1001, vpin: 33, label: "S1 West Shared Beam" },
    { id: 1002, vpin: 26, label: "S2 East Shared Beam" }
  ]
};

module.exports = { layout };
