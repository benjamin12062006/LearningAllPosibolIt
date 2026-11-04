import { describe, expect, it } from '@jest/globals';
import {
  literalAddressOf,
  parseSourceUrl,
  SOURCE_URL_MAX_LENGTH,
} from '../../../src/remote-source/source-url.js';

describe('URL de la fuente', () => {
  it('admite https con ruta, puerto y consulta', () => {
    const url = parseSourceUrl(
      'https://tienda.example.com:8443/export/productos.csv?dia=hoy',
    );

    expect(url?.hostname).toBe('tienda.example.com');
    expect(url?.port).toBe('8443');
  });

  it('rechaza otros esquemas, credenciales y textos que no son URL', () => {
    for (const raw of [
      'http://tienda.example.com/a.csv',
      'ftp://tienda.example.com/a.csv',
      'file:///etc/passwd',
      'javascript:alert(1)',
      'https://usuario:clave@tienda.example.com/a.csv',
      'https://usuario@tienda.example.com/a.csv',
      'tienda.example.com/a.csv',
      'https://',
      '',
    ]) {
      expect(parseSourceUrl(raw)).toBeNull();
    }
  });

  it('http solo si se permite (pruebas)', () => {
    expect(
      parseSourceUrl('http://localhost:3000/a.csv', { allowHttp: true }),
    ).not.toBeNull();
    expect(parseSourceUrl('http://localhost:3000/a.csv')).toBeNull();
  });

  it('como mucho 2.048 caracteres', () => {
    const base = 'https://tienda.example.com/';
    const fits = base + 'a'.repeat(SOURCE_URL_MAX_LENGTH - base.length);

    expect(parseSourceUrl(fits)).not.toBeNull();
    expect(parseSourceUrl(`${fits}a`)).toBeNull();
  });

  it('reconoce IP escritas en la URL, también IPv6 entre corchetes', () => {
    expect(literalAddressOf(new URL('https://10.0.0.1/a.csv'))).toBe(
      '10.0.0.1',
    );
    expect(literalAddressOf(new URL('https://[::1]:8443/a.csv'))).toBe('::1');
    expect(
      literalAddressOf(new URL('https://tienda.example.com/a')),
    ).toBeNull();
  });

  it('las formas raras de escribir una IP llegan normalizadas', () => {
    // El analizador de URL de WHATWG convierte estas formas a la IPv4 decimal.
    expect(literalAddressOf(new URL('https://2130706433/a.csv'))).toBe(
      '127.0.0.1',
    );
    expect(literalAddressOf(new URL('https://0x7f.1/a.csv'))).toBe('127.0.0.1');
  });
});
