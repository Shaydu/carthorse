/**
 * Base interface for all service results
 * Provides consistent success/error handling across all services
 */
export interface BaseServiceResult {
  success: boolean;
  error?: string;
}
