// Empty utilityProcess for memory baseline.
process.parentPort.on('message', () => {});
setInterval(() => {}, 1e6);
