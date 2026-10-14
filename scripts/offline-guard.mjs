// Test preloader: reject internet connections before DNS resolution or socket I/O.
// This is a regression guard, not a replacement for appliance firewall rules.
import net from 'node:net';
import { syncBuiltinESMExports } from 'node:module';

export function assertLoopback(host) {
  const value = String(host || 'localhost')
    .toLowerCase()
    .replace(/^\[|\]$/g, '');
  const localV4 = net.isIPv4(value) && value.startsWith('127.');
  if (!(value === 'localhost' || value === '::1' || localV4 || /^::ffff:127\.\d+\.\d+\.\d+$/.test(value))) {
    const error = new Error(`Offline test blocked outbound connection to ${value}`);
    error.code = 'MANE_OUTBOUND_BLOCKED';
    throw error;
  }
}

const originalConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...input) {
  const args = Array.isArray(input[0]) ? input[0] : input;
  const first = args[0];
  if (typeof first === 'object' && first !== null) {
    // Unix domain sockets are local IPC. Network sockets specify port/host.
    if (!(typeof first.path === 'string' && first.port === undefined))
      assertLoopback(first.host || first.hostname);
  } else if (typeof first === 'number' || (typeof first === 'string' && /^\d+$/.test(first))) {
    assertLoopback(typeof args[1] === 'string' ? args[1] : 'localhost');
  } else if (typeof first !== 'string') {
    throw new Error('Offline test encountered an unsupported socket address');
  }
  return originalConnect.apply(this, input);
};
syncBuiltinESMExports();
