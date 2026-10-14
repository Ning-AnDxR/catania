import { RESOURCES, TERRAIN_TO_RESOURCE } from "./constants.js";
import { shuffle } from "./rng.js";

export const HEX_SIZE = 1;

const TERRAIN_POOL = [
  "forest",
  "forest",
  "forest",
  "forest",
  "pasture",
  "pasture",
  "pasture",
  "pasture",
  "fields",
  "fields",
  "fields",
  "fields",
  "hills",
  "hills",
  "hills",
  "mountains",
  "mountains",
  "mountains",
  "desert",
];

const NUMBER_POOL = [2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12];
const HARBOR_POOL = ["any", "any", "any", "any", "wood", "brick", "sheep", "wheat", "ore"];

function axialToWorld(q, r, size = HEX_SIZE) {
  return {
    x: size * Math.sqrt(3) * (q + r / 2),
    z: size * 1.5 * r,
  };
}

function hexCorner(centerX, centerZ, index, size = HEX_SIZE) {
  const angle = (Math.PI / 180) * (60 * index - 30);
  return {
    x: centerX + size * Math.cos(angle),
    z: centerZ + size * Math.sin(angle),
  };
}

function hexDistance(first, second) {
  const dq = first.q - second.q;
  const dr = first.r - second.r;
  const ds = -first.q - first.r + second.q + second.r;
  return Math.max(Math.abs(dq), Math.abs(dr), Math.abs(ds));
}

function validNumberPlacement(hexes, numbers) {
  for (let first = 0; first < hexes.length; first += 1) {
    if (numbers[first] !== 6 && numbers[first] !== 8) continue;
    for (let second = first + 1; second < hexes.length; second += 1) {
      const highValue = numbers[second] === 6 || numbers[second] === 8;
      if (highValue && hexDistance(hexes[first], hexes[second]) === 1) {
        return false;
      }
    }
  }
  return true;
}

/* 按角点把地块分组：同一组就是同一个交点，组里 3 片地的那种是「三岔交点」。
   角点键必须和下面建顶点时用的一致，不然分组和真实交点对不上。 */
function groupHexesByCorner(hexes) {
  const groups = new Map();
  hexes.forEach((hex, index) => {
    const world = axialToWorld(hex.q, hex.r);
    for (let corner = 0; corner < 6; corner += 1) {
      const point = hexCorner(world.x, world.z, corner);
      const key = `${Math.round(point.x * 1000)},${Math.round(point.z * 1000)}`;
      const bucket = groups.get(key);
      if (bucket) bucket.push(index);
      else groups.set(key, [index]);
    }
  });
  return groups;
}

/* 一个交点不许接壤三片相同资源：三片同色会让这个点变成唯一落子答案，
   先手直接站上去就赢在起跑线。只有 3 片地的交点才可能犯规。 */
function validTerrainPlacement(cornerGroups, terrains) {
  for (const bucket of cornerGroups.values()) {
    if (bucket.length < 3) continue;
    const first = terrains[bucket[0]];
    if (bucket.every((index) => terrains[index] === first)) return false;
  }
  return true;
}

function buildAxialHexes() {
  const hexes = [];
  for (let q = -2; q <= 2; q += 1) {
    for (let r = -2; r <= 2; r += 1) {
      if (Math.abs(-q - r) <= 2) hexes.push({ q, r });
    }
  }
  return hexes;
}

export function generateBoard(seed) {
  const rng = seedToRng(seed);
  const baseHexes = buildAxialHexes();
  const cornerGroups = groupHexesByCorner(baseHexes);

  let terrains = null;
  for (let attempt = 0; attempt < 1000 && !terrains; attempt += 1) {
    const candidate = shuffle([...TERRAIN_POOL], rng);
    if (validTerrainPlacement(cornerGroups, candidate)) terrains = candidate;
  }
  if (!terrains) terrains = shuffle([...TERRAIN_POOL], rng);

  let numbers = null;
  for (let attempt = 0; attempt < 1000 && !numbers; attempt += 1) {
    const pool = shuffle([...NUMBER_POOL], rng);
    let poolIndex = 0;
    const candidate = terrains.map((terrain) => {
      if (terrain === "desert") return null;
      const value = pool[poolIndex];
      poolIndex += 1;
      return value;
    });
    if (validNumberPlacement(baseHexes, candidate)) numbers = candidate;
  }

  if (!numbers) {
    let poolIndex = 0;
    numbers = terrains.map((terrain) => {
      if (terrain === "desert") return null;
      const value = NUMBER_POOL[poolIndex];
      poolIndex += 1;
      return value;
    });
  }

  const vertices = [];
  const edges = [];
  const vertexByKey = new Map();
  const edgeByKey = new Map();

  const hexes = baseHexes.map((hex, index) => {
    const world = axialToWorld(hex.q, hex.r);
    const terrain = terrains[index];
    const vertexIds = [];

    for (let corner = 0; corner < 6; corner += 1) {
      const point = hexCorner(world.x, world.z, corner);
      const key = `${Math.round(point.x * 1000)},${Math.round(point.z * 1000)}`;
      let vertex = vertexByKey.get(key);

      if (!vertex) {
        vertex = {
          id: vertices.length,
          x: point.x,
          z: point.z,
          hexIds: [],
          adjacentVertexIds: [],
          edgeIds: [],
          building: null,
          harbor: null,
        };
        vertexByKey.set(key, vertex);
        vertices.push(vertex);
      }

      if (!vertex.hexIds.includes(index)) vertex.hexIds.push(index);
      vertexIds.push(vertex.id);
    }

    const edgeIds = [];
    for (let corner = 0; corner < 6; corner += 1) {
      const first = vertexIds[corner];
      const second = vertexIds[(corner + 1) % 6];
      const low = Math.min(first, second);
      const high = Math.max(first, second);
      const key = `${low}-${high}`;
      let edge = edgeByKey.get(key);

      if (!edge) {
        edge = {
          id: edges.length,
          v1: low,
          v2: high,
          hexIds: [],
          harbor: null,
          road: null,
        };
        edgeByKey.set(key, edge);
        edges.push(edge);
        vertices[low].adjacentVertexIds.push(high);
        vertices[high].adjacentVertexIds.push(low);
        vertices[low].edgeIds.push(edge.id);
        vertices[high].edgeIds.push(edge.id);
      }

      if (!edge.hexIds.includes(index)) edge.hexIds.push(index);
      edgeIds.push(edge.id);
    }

    return {
      id: index,
      q: hex.q,
      r: hex.r,
      x: world.x,
      z: world.z,
      terrain,
      resource: TERRAIN_TO_RESOURCE[terrain],
      number: numbers[index],
      vertexIds,
      edgeIds,
    };
  });

  const coastalEdges = edges
    .filter((edge) => edge.hexIds.length === 1)
    .map((edge) => {
      const first = vertices[edge.v1];
      const second = vertices[edge.v2];
      const x = (first.x + second.x) / 2;
      const z = (first.z + second.z) / 2;
      return { edge, x, z, angle: Math.atan2(z, x) };
    })
    .sort((first, second) => first.angle - second.angle);

  const harborTypes = shuffle([...HARBOR_POOL], rng);
  const usedVertices = new Set();
  const selectedCoastal = [];

  for (let index = 0; index < 9; index += 1) {
    const preferred = Math.floor((index * coastalEdges.length) / 9);
    let picked = null;

    for (let offset = 0; offset < coastalEdges.length; offset += 1) {
      const candidate = coastalEdges[(preferred + offset) % coastalEdges.length];
      const edge = candidate.edge;
      if (usedVertices.has(edge.v1) || usedVertices.has(edge.v2)) continue;
      picked = candidate;
      break;
    }

    if (!picked) picked = coastalEdges[preferred];
    const edge = picked.edge;
    const type = harborTypes[index];
    edge.harbor = { type };
    vertices[edge.v1].harbor = type;
    vertices[edge.v2].harbor = type;
    usedVertices.add(edge.v1);
    usedVertices.add(edge.v2);
    selectedCoastal.push({
      edgeId: edge.id,
      type,
      x: picked.x,
      z: picked.z,
    });
  }

  for (const vertex of vertices) {
    vertex.adjacentVertexIds = [...new Set(vertex.adjacentVertexIds)];
    vertex.edgeIds = [...new Set(vertex.edgeIds)];
  }

  const desert = hexes.find((hex) => hex.terrain === "desert");

  return {
    hexes,
    vertices,
    edges,
    harbors: selectedCoastal,
    robberHexId: desert.id,
  };
}

function seedToRng(seed) {
  let state = 2166136261;
  for (const character of String(seed)) {
    state ^= character.charCodeAt(0);
    state = Math.imul(state, 16777619);
  }

  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export function isVertexFree(board, vertexId) {
  const vertex = board.vertices[vertexId];
  if (!vertex || vertex.building) return false;
  return vertex.adjacentVertexIds.every((adjacentId) => !board.vertices[adjacentId].building);
}

export function legalInitialSettlementVertices(board) {
  return board.vertices.filter((vertex) => isVertexFree(board, vertex.id)).map((vertex) => vertex.id);
}

export function legalInitialRoadEdges(board, settlementVertexId) {
  const vertex = board.vertices[settlementVertexId];
  if (!vertex) return [];
  return vertex.edgeIds.filter((edgeId) => !board.edges[edgeId].road);
}

export function isRoadConnectedToPlayer(board, edgeId, playerId) {
  const edge = board.edges[edgeId];
  if (!edge || edge.road) return false;

  const endpoints = [board.vertices[edge.v1], board.vertices[edge.v2]];
  if (
    endpoints.some(
      (vertex) => vertex.building && vertex.building.playerId !== playerId,
    )
  ) {
    return false;
  }

  return endpoints.some((vertex) => {
    if (vertex.building?.playerId === playerId) return true;
    return vertex.edgeIds.some(
      (connectedEdgeId) =>
        connectedEdgeId !== edgeId &&
        board.edges[connectedEdgeId].road?.playerId === playerId,
    );
  });
}

export function legalBuildRoadEdges(board, playerId) {
  return board.edges
    .filter((edge) => isRoadConnectedToPlayer(board, edge.id, playerId))
    .map((edge) => edge.id);
}

export function legalBuildSettlementVertices(board, playerId) {
  return board.vertices
    .filter((vertex) => {
      if (vertex.building || !isVertexFree(board, vertex.id)) return false;
      return vertex.edgeIds.some(
        (edgeId) => board.edges[edgeId].road?.playerId === playerId,
      );
    })
    .map((vertex) => vertex.id);
}

export function legalBuildCityVertices(board, playerId) {
  return board.vertices
    .filter(
      (vertex) =>
        vertex.building?.playerId === playerId &&
        vertex.building.type === "settlement",
    )
    .map((vertex) => vertex.id);
}

export function validateBoard(board) {
  const errors = [];
  if (board.hexes.length !== 19) errors.push(`Expected 19 hexes, got ${board.hexes.length}`);
  if (board.vertices.length !== 54) errors.push(`Expected 54 vertices, got ${board.vertices.length}`);
  if (board.edges.length !== 72) errors.push(`Expected 72 edges, got ${board.edges.length}`);
  if (board.harbors.length !== 9) errors.push(`Expected 9 harbors, got ${board.harbors.length}`);

  for (const resource of RESOURCES) {
    const expected = resource === "wood" || resource === "sheep" || resource === "wheat" ? 4 : 3;
    const actual = board.hexes.filter((hex) => hex.resource === resource).length;
    if (actual !== expected) errors.push(`Expected ${expected} ${resource} hexes, got ${actual}`);
  }

  return errors;
}
