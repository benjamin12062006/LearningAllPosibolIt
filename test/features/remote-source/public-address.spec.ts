import { describe, expect, it } from '@jest/globals';
import { isPublicAddress } from '../../../src/remote-source/public-address.js';

describe('Direcciones públicas (F21, F34, F35)', () => {
  it('admite direcciones públicas IPv4 e IPv6', () => {
    for (const address of [
      '8.8.8.8',
      '1.1.1.1',
      '93.184.215.14',
      '2606:4700:4700::1111',
      '2a00:1450:4001:80b::200e',
    ]) {
      expect(isPublicAddress(address)).toBe(true);
    }
  });

  it.each([
    ['esta red', '0.0.0.0'],
    ['uso privado 10/8', '10.1.2.3'],
    ['espacio compartido 100.64/10', '100.64.0.1'],
    ['loopback', '127.0.0.1'],
    ['loopback alto', '127.255.255.254'],
    ['link-local y metadatos', '169.254.169.254'],
    ['uso privado 172.16/12', '172.31.255.255'],
    ['asignaciones IETF', '192.0.0.8'],
    ['documentación 1', '192.0.2.10'],
    ['relé 6to4', '192.88.99.2'],
    ['uso privado 192.168/16', '192.168.1.1'],
    ['pruebas de rendimiento', '198.19.0.1'],
    ['documentación 2', '198.51.100.7'],
    ['documentación 3', '203.0.113.9'],
    ['multicast', '224.0.0.1'],
    ['reservada', '240.0.0.1'],
    ['difusión limitada', '255.255.255.255'],
  ])('rechaza IPv4 %s (%s)', (_name, address) => {
    expect(isPublicAddress(address)).toBe(false);
  });

  it.each([
    ['sin especificar', '::'],
    ['loopback', '::1'],
    ['IPv4 mapeada a loopback', '::ffff:127.0.0.1'],
    ['IPv4 mapeada aunque sea pública', '::ffff:8.8.8.8'],
    ['traducción IPv4/IPv6', '64:ff9b::a00:1'],
    ['traducción local', '64:ff9b:1::1'],
    ['descarte', '100::1'],
    ['asignaciones IETF y Teredo', '2001::1'],
    ['documentación', '2001:db8::1'],
    ['6to4', '2002:a00:1::1'],
    ['documentación nueva', '3fff::1'],
    ['SRv6', '5f00::1'],
    ['única local', 'fd12:3456::1'],
    ['link-local', 'fe80::1'],
    ['multicast', 'ff02::1'],
  ])('rechaza IPv6 %s (%s)', (_name, address) => {
    expect(isPublicAddress(address)).toBe(false);
  });

  it('un texto que no es una IP no es público', () => {
    for (const value of ['', 'localhost', 'example.com', '[::1]', '1.2.3']) {
      expect(isPublicAddress(value)).toBe(false);
    }
  });
});
