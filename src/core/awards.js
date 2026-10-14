export function calculateLongestRoadLength(board, playerId) {
  const playerEdges = board.edges.filter((edge) => edge.road?.playerId === playerId);
  if (playerEdges.length === 0) return 0;

  const playerEdgeIds = new Set(playerEdges.map((edge) => edge.id));
  const startingVertices = new Set(
    playerEdges.flatMap((edge) => [edge.v1, edge.v2]),
  );
  let longest = 0;

  for (const vertexId of startingVertices) {
    const vertex = board.vertices[vertexId];
    if (vertex.building && vertex.building.playerId !== playerId) continue;
    walk(vertexId, new Set([vertexId]), new Set(), 0);
  }

  return longest;

  function walk(vertexId, visitedVertices, usedEdges, length) {
    const vertex = board.vertices[vertexId];
    if (vertex.building && vertex.building.playerId !== playerId) return;

    for (const edgeId of vertex.edgeIds) {
      if (!playerEdgeIds.has(edgeId) || usedEdges.has(edgeId)) continue;

      const edge = board.edges[edgeId];
      const nextVertexId = edge.v1 === vertexId ? edge.v2 : edge.v1;
      if (visitedVertices.has(nextVertexId)) continue;
      const nextVertex = board.vertices[nextVertexId];
      if (nextVertex.building && nextVertex.building.playerId !== playerId) continue;

      const nextLength = length + 1;
      longest = Math.max(longest, nextLength);
      visitedVertices.add(nextVertexId);
      usedEdges.add(edgeId);
      walk(nextVertexId, visitedVertices, usedEdges, nextLength);
      usedEdges.delete(edgeId);
      visitedVertices.delete(nextVertexId);
    }
  }
}
