import { BlockList, isIP } from 'node:net';

type Subnet = readonly [network: string, prefix: number];

/**
 * Bloques IPv4 no alcanzables globalmente según IANA (F34), más multicast
 * (F21). `192.0.0.0/24` se bloquea entero aunque tenga dos direcciones anycast
 * globales: un catálogo nunca estará allí.
 */
const NON_PUBLIC_IPV4: readonly Subnet[] = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  // Incluye 255.255.255.255 (difusión limitada).
  ['240.0.0.0', 4],
];

/**
 * Bloques IPv6 especiales según IANA (F35), más multicast (F21). Los prefijos de
 * traducción y túnel (`64:ff9b::/96`, `2001::/23`, `2002::/16`) se bloquean
 * aunque alguno sea global: pueden llevar a una IPv4 privada.
 */
const NON_PUBLIC_IPV6: readonly Subnet[] = [
  ['::', 128],
  ['::1', 128],
  ['::ffff:0:0', 96],
  ['64:ff9b::', 96],
  ['64:ff9b:1::', 48],
  ['100::', 64],
  ['2001::', 23],
  ['2001:db8::', 32],
  ['2002::', 16],
  ['3fff::', 20],
  ['5f00::', 16],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
];

/**
 * Una lista por familia: en una sola, la regla IPv6 `::ffff:0:0/96` (IPv4
 * mapeada) también coincide con cualquier IPv4 y las bloquearía todas
 * (comprobado con las pruebas; F33 documenta solo el sentido contrario).
 */
const NON_PUBLIC = {
  4: blockListOf(NON_PUBLIC_IPV4, 'ipv4'),
  6: blockListOf(NON_PUBLIC_IPV6, 'ipv6'),
} as const;

/**
 * `true` solo para una dirección IP válida que no está en ningún bloque
 * especial. Un texto que no es una IP no es público.
 */
export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) {
    return !NON_PUBLIC[4].check(address, 'ipv4');
  }
  if (family === 6) {
    return !NON_PUBLIC[6].check(address, 'ipv6');
  }
  return false;
}

function blockListOf(subnets: readonly Subnet[], type: 'ipv4' | 'ipv6') {
  const blockList = new BlockList();
  for (const [network, prefix] of subnets) {
    blockList.addSubnet(network, prefix, type);
  }
  return blockList;
}
