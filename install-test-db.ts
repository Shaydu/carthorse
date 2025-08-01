import { CarthorseOrchestrator } from './src/orchestrator/CarthorseOrchestrator';

async function installTestDatabase() {
  console.log('🚀 Installing Carthorse Database for Test Environment');
  console.log('==================================================');
  
  try {
    // Set environment for test database
    process.env.PGUSER = 'tester';
    process.env.PGDATABASE = 'trail_master_db_test';
    
    console.log('📋 Installing to test database: trail_master_db_test');
    
    // Run the installation
    await CarthorseOrchestrator.install();
    
    console.log('✅ Installation completed successfully!');
    
  } catch (error) {
    console.error('❌ Installation failed:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

installTestDatabase(); 