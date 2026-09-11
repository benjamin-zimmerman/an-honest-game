importScripts('app-1.js', 'app-2.js', 'app-3.js');

self.onmessage = ({ data }) => {
  try {
    self.postMessage({ id: data.id, result: planMachineTurn(data.input) });
  } catch (error) {
    self.postMessage({ id: data.id, error: error.message || 'Position analysis failed.' });
  }
};
