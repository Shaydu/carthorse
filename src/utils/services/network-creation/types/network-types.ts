import { Pool } from 'pg';

export interface NetworkConfig {
  stagingSchema: string;
  usePgNodeNetwork: boolean;
  tolerances: {
    intersectionDetectionTolerance: number;
    edgeToVertexTolerance: number;
    graphAnalysisTolerance: number;
    trueLoopTolerance: number;
    minTrailLengthMeters: number;
    maxTrailLengthMeters: number;
  };
}

export interface NetworkResult {
  success: boolean;
  error?: string;
  stats: {
    nodesCreated: number;
    edgesCreated: number;
    isolatedNodes: number;
    orphanedEdges: number;
  };
}

export interface NetworkCreationStrategy {
  createNetwork(pgClient: Pool, config: NetworkConfig): Promise<NetworkResult>;
} 