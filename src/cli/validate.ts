import { DataIntegrityValidator } from '../validation/DataIntegrityValidator';

export async function runValidation(region: string, databaseConfig: any): Promise<void> {
  const validator = new DataIntegrityValidator(databaseConfig);
  await validator.connect();
  
  try {
    const result = await validator.validateRegion(region);
    console.log(`Validation result for ${region}:`, result);
  } finally {
    await validator.disconnect();
  }
} 