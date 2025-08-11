"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runValidation = runValidation;
const DataIntegrityValidator_1 = require("../validation/DataIntegrityValidator");
async function runValidation(region, databaseConfig) {
    const validator = new DataIntegrityValidator_1.DataIntegrityValidator(databaseConfig);
    await validator.connect();
    try {
        const result = await validator.validateRegion(region);
        console.log(`Validation result for ${region}:`, result);
    }
    finally {
        await validator.disconnect();
    }
}
//# sourceMappingURL=validate.js.map