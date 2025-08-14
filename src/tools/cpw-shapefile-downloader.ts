#!/usr/bin/env node
import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import * as extract from 'extract-zip';
import { execSync } from 'child_process';

interface CPWShapefileInfo {
  name: string;
  features: number;
  geometryType: string;
  extent: {
    xmin: number;
    ymin: number;
    xmax: number;
    ymax: number;
  };
  fields: string[];
}

class CPWShapefileDownloader {
  private readonly outputDir = 'data/cpw-shapefiles';
  private readonly tempDir = 'data/cpw-shapefiles/temp';
  private readonly cpwDataUrl = 'https://opendata.arcgis.com/datasets/CPW::cpwadmindata.zip';

  constructor(private localZipPath?: string) {}

  async downloadShapefiles(): Promise<void> {
    console.log('🏔️ Starting CPW shapefile processing...');
    
    // Create output directories
    if (!fs.existsSync(this.outputDir)) {
      fs.mkdirSync(this.outputDir, { recursive: true });
    }
    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true });
    }

    let zipPath: string;
    let extractedPath: string;

    try {
      if (this.localZipPath && fs.existsSync(this.localZipPath)) {
        console.log(`📁 Using local zip file: ${this.localZipPath}`);
        zipPath = this.localZipPath;
      } else {
        console.log('📥 Downloading CPW shapefile data...');
        zipPath = await this.downloadZipFile();
      }

      console.log('📦 Extracting shapefiles...');
      extractedPath = await this.extractZipFile(zipPath);

      console.log('🔧 Processing shapefiles...');
      await this.processShapefiles(extractedPath);

      console.log('🧹 Cleaning up temporary files...');
      await this.cleanup(zipPath, extractedPath);

      console.log('✅ CPW shapefile processing complete!');
      console.log(`📁 Output directory: ${path.resolve(this.outputDir)}`);

    } catch (error) {
      console.error('❌ Error processing shapefiles:', error);
      throw error;
    }
  }

  private async downloadZipFile(): Promise<string> {
    const zipPath = path.join(this.tempDir, 'cpw-data.zip');
    
    const response = await axios.get(this.cpwDataUrl, {
      responseType: 'stream',
      timeout: 300000 // 5 minutes
    });

    const writer = fs.createWriteStream(zipPath);
    response.data.pipe(writer);

    return new Promise((resolve, reject) => {
      writer.on('finish', () => resolve(zipPath));
      writer.on('error', reject);
    });
  }

  private async extractZipFile(zipPath: string): Promise<string> {
    const extractedPath = path.join(this.tempDir, 'extracted');
    
    if (!fs.existsSync(extractedPath)) {
      fs.mkdirSync(extractedPath, { recursive: true });
    }

    await extract(zipPath, { dir: extractedPath });
    return extractedPath;
  }

  private async processShapefiles(extractedPath: string): Promise<void> {
    const shapefiles = this.findShapefiles(extractedPath);
    
    if (shapefiles.length === 0) {
      throw new Error('No shapefiles found in extracted directory');
    }

    console.log(`📊 Found ${shapefiles.length} shapefile(s):`);
    shapefiles.forEach(sf => console.log(`   - ${path.basename(sf)}`));

    for (const shapefilePath of shapefiles) {
      await this.processShapefile(shapefilePath);
    }

    await this.generateOverallSummary(shapefiles);
  }

  private findShapefiles(directory: string): string[] {
    const shapefiles: string[] = [];
    
    const processDirectory = (dir: string) => {
      const items = fs.readdirSync(dir);
      
      for (const item of items) {
        const fullPath = path.join(dir, item);
        const stat = fs.statSync(fullPath);
        
        if (stat.isDirectory()) {
          processDirectory(fullPath);
        } else if (item.endsWith('.shp')) {
          shapefiles.push(fullPath);
        }
      }
    };

    processDirectory(directory);
    return shapefiles;
  }

  private async processShapefile(shapefilePath: string): Promise<void> {
    const basename = path.basename(shapefilePath, '.shp');
    console.log(`\n🔍 Processing: ${basename}`);

    try {
      // Get shapefile info using ogrinfo
      const info = await this.getShapefileInfo(shapefilePath);
      console.log(`   📊 Features: ${info.features}`);
      console.log(`   📐 Geometry: ${info.geometryType}`);
      console.log(`   📋 Fields: ${info.fields.length}`);

      // Convert to GeoJSON
      const geojsonPath = await this.convertToGeoJSON(shapefilePath);
      console.log(`   ✅ Converted to GeoJSON: ${path.basename(geojsonPath)}`);

      // Copy shapefile to output
      await this.copyShapefileToOutput(shapefilePath);
      console.log(`   📁 Copied shapefile to output`);

      // Generate summary
      await this.generateShapefileSummary(shapefilePath, geojsonPath, info);
      console.log(`   📝 Generated summary`);

    } catch (error) {
      console.error(`   ❌ Error processing ${basename}:`, error);
      throw error;
    }
  }

  private async getShapefileInfo(shapefilePath: string): Promise<CPWShapefileInfo> {
    try {
      const output = execSync(`ogrinfo -so "${shapefilePath}"`, { encoding: 'utf8' });
      
      const lines = output.split('\n');
      const info: CPWShapefileInfo = {
        name: path.basename(shapefilePath, '.shp'),
        features: 0,
        geometryType: 'Unknown',
        extent: { xmin: 0, ymin: 0, xmax: 0, ymax: 0 },
        fields: []
      };

      for (const line of lines) {
        if (line.includes('Feature Count:')) {
          info.features = parseInt(line.split(':')[1].trim());
        } else if (line.includes('Geometry Type:')) {
          info.geometryType = line.split(':')[1].trim();
        } else if (line.includes('Extent:')) {
          const extentMatch = line.match(/\(([^,]+), ([^)]+)\) - \(([^,]+), ([^)]+)\)/);
          if (extentMatch) {
            info.extent = {
              xmin: parseFloat(extentMatch[1]),
              ymin: parseFloat(extentMatch[2]),
              xmax: parseFloat(extentMatch[3]),
              ymax: parseFloat(extentMatch[4])
            };
          }
        } else if (line.includes(':')) {
          const fieldMatch = line.match(/^\s*(\w+):\s*(.+)$/);
          if (fieldMatch && !['Feature Count', 'Geometry Type', 'Extent'].includes(fieldMatch[1])) {
            info.fields.push(fieldMatch[1]);
          }
        }
      }

      return info;
    } catch (error) {
      console.error('Error getting shapefile info:', error);
      throw error;
    }
  }

  private async convertToGeoJSON(shapefilePath: string): Promise<string> {
    const basename = path.basename(shapefilePath, '.shp');
    const geojsonPath = path.join(this.outputDir, `${basename}.geojson`);
    
    try {
      execSync(`ogr2ogr -f GeoJSON "${geojsonPath}" "${shapefilePath}"`, { stdio: 'inherit' });
      return geojsonPath;
    } catch (error) {
      console.error('Error converting to GeoJSON:', error);
      throw error;
    }
  }

  private async generateShapefileSummary(shapefilePath: string, geojsonPath: string, info: CPWShapefileInfo): Promise<void> {
    const basename = path.basename(shapefilePath, '.shp');
    const summaryPath = path.join(this.outputDir, `${basename}-summary.txt`);
    
    const summary = `CPW Shapefile Summary: ${basename}
Generated: ${new Date().toISOString()}

File Information:
- Shapefile: ${path.basename(shapefilePath)}
- GeoJSON: ${path.basename(geojsonPath)}
- Features: ${info.features}
- Geometry Type: ${info.geometryType}

Extent:
- X: ${info.extent.xmin} to ${info.extent.xmax}
- Y: ${info.extent.ymin} to ${info.extent.ymax}

Fields (${info.fields.length}):
${info.fields.map(field => `- ${field}`).join('\n')}

Processing Notes:
- Converted using GDAL ogr2ogr
- Preserved original coordinate system
- All features included in conversion
`;

    fs.writeFileSync(summaryPath, summary);
  }

  private async copyShapefileToOutput(shapefilePath: string): Promise<void> {
    const basename = path.basename(shapefilePath, '.shp');
    const outputDir = path.join(this.outputDir, basename);
    
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // Copy all related files (.shp, .shx, .dbf, .prj, etc.)
    const shapefileDir = path.dirname(shapefilePath);
    const files = fs.readdirSync(shapefileDir);
    
    for (const file of files) {
      if (file.startsWith(basename + '.')) {
        const sourcePath = path.join(shapefileDir, file);
        const destPath = path.join(outputDir, file);
        fs.copyFileSync(sourcePath, destPath);
      }
    }
  }

  private async generateOverallSummary(shapefiles: string[]): Promise<void> {
    const summaryPath = path.join(this.outputDir, 'overall-summary.txt');
    
    const summary = `CPW Data Processing Summary
Generated: ${new Date().toISOString()}

Processing Details:
- Total shapefiles processed: ${shapefiles.length}
- Output directory: ${path.resolve(this.outputDir)}
- Processing method: GDAL ogr2ogr

Shapefiles:
${shapefiles.map(sf => `- ${path.basename(sf)}`).join('\n')}

Next Steps:
1. Review the generated GeoJSON files
2. Check the individual shapefile summaries
3. Use the data in your trail processing pipeline
4. Consider running the merge process to combine with existing trail data

For more information, see the individual shapefile summary files.
`;

    fs.writeFileSync(summaryPath, summary);
    console.log(`\n📝 Overall summary written to: ${summaryPath}`);
  }

  private async cleanup(zipPath: string, extractedPath: string): Promise<void> {
    // Only cleanup if we downloaded the file (not if using local file)
    if (!this.localZipPath) {
      if (fs.existsSync(zipPath)) {
        fs.unlinkSync(zipPath);
      }
    }
    
    if (fs.existsSync(extractedPath)) {
      fs.rmSync(extractedPath, { recursive: true, force: true });
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

async function main(): Promise<void> {
  // Check if GDAL is installed
  try {
    execSync('ogrinfo --version', { stdio: 'pipe' });
  } catch (error) {
    console.error('❌ GDAL is not installed or not in PATH');
    console.error('Please install GDAL first:');
    console.error('  macOS: brew install gdal');
    console.error('  Ubuntu: sudo apt-get install gdal-bin');
    console.error('  Windows: Download from https://gdal.org/download.html');
    process.exit(1);
  }

  // Check for local zip file
  const localZipPath = process.argv[2] || 'COTREX_Trails.zip';
  
  if (fs.existsSync(localZipPath)) {
    console.log(`📁 Found local zip file: ${localZipPath}`);
  } else {
    console.log(`⚠️ Local file not found: ${localZipPath}`);
    console.log('Will download from CPW server...');
  }

  const downloader = new CPWShapefileDownloader(fs.existsSync(localZipPath) ? localZipPath : undefined);
  await downloader.downloadShapefiles();
}

if (require.main === module) {
  main().catch(error => {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  });
}
