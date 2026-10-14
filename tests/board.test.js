import test from "node:test";
import assert from "node:assert/strict";

import {
  generateBoard,
  isVertexFree,
  legalInitialRoadEdges,
  legalInitialSettlementVertices,
  validateBoard,
} from "../src/core/board.js";

test("generates a valid standard board", () => {
  const board = generateBoard("board-test");
  assert.deepEqual(validateBoard(board), []);
});

test("same seed generates the same board", () => {
  const first = generateBoard("repeatable-seed");
  const second = generateBoard("repeatable-seed");
  assert.deepEqual(first, second);
});

test("initial placement targets respect the distance rule", () => {
  const board = generateBoard("distance-test");
  const firstVertexId = legalInitialSettlementVertices(board)[0];
  const firstVertex = board.vertices[firstVertexId];
  firstVertex.building = { playerId: 0, type: "settlement" };

  assert.equal(isVertexFree(board, firstVertexId), false);
  for (const adjacentId of firstVertex.adjacentVertexIds) {
    assert.equal(isVertexFree(board, adjacentId), false);
  }

  const nextLegal = legalInitialSettlementVertices(board);
  assert.ok(nextLegal.length > 0);
  assert.ok(!nextLegal.includes(firstVertexId));
});

test("initial roads must touch the settlement just placed", () => {
  const board = generateBoard("road-test");
  const settlementVertexId = legalInitialSettlementVertices(board)[0];
  const legalEdges = legalInitialRoadEdges(board, settlementVertexId);

  assert.ok(legalEdges.length > 0);
  for (const edgeId of legalEdges) {
    const edge = board.edges[edgeId];
    assert.ok(
      edge.v1 === settlementVertexId || edge.v2 === settlementVertexId,
      `Edge ${edgeId} is not attached to ${settlementVertexId}`,
    );
  }
});

test("no vertex touches three hexes of the same resource", () => {
  for (let index = 0; index < 40; index += 1) {
    const seed = `terrain-spread-${index}`;
    const board = generateBoard(seed);
    for (const vertex of board.vertices) {
      if (vertex.hexIds.length < 3) continue;
      const terrains = vertex.hexIds.map((hexId) => board.hexes[hexId].terrain);
      assert.ok(
        new Set(terrains).size > 1,
        `${seed}: vertex ${vertex.id} touches ${terrains.join(" / ")}`,
      );
    }
  }
});

