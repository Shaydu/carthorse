import * as tf from '@tensorflow/tfjs-node';
import * as numpy from 'numpy';

export interface LocalMLModelConfig {
  modelType: 'graph_neural_network' | 'sequence_classifier' | 'quality_scorer' | 'custom';
  modelPath?: string; // Path to local model file
  modelName?: string; // Hugging Face model name for download
  useGPU: boolean;
  batchSize: number;
  maxSequenceLength: number;
  confidenceThreshold: number;
}

export interface ModelInput {
  nodeFeatures: number[][];
  edgeFeatures: number[][];
  adjacencyMatrix: number[][];
  sequenceData?: number[][];
  metadata?: any;
}

export interface ModelOutput {
  predictions: number[];
  confidence: number[];
  embeddings?: number[][];
  attentionWeights?: number[][];
}

export class LocalMLModelService {
  private config: LocalMLModelConfig;
  private models: Map<string, any> = new Map();
  private isInitialized: boolean = false;

  constructor(config: LocalMLModelConfig) {
    this.config = config;
  }

  /**
   * Initialize the ML model service
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    console.log('🤖 [LOCAL-ML] Initializing local ML model service...');

    try {
      // Configure TensorFlow for optimal performance
      await this.configureTensorFlow();
      
      // Load or create models based on configuration
      await this.loadModels();
      
      this.isInitialized = true;
      console.log('✅ [LOCAL-ML] Local ML model service initialized successfully');
    } catch (error) {
      console.error('❌ [LOCAL-ML] Error initializing ML model service:', error);
      throw error;
    }
  }

  /**
   * Configure TensorFlow for optimal performance
   */
  private async configureTensorFlow(): Promise<void> {
    try {
      // Enable GPU if available and requested
      if (this.config.useGPU) {
        const gpuAvailable = tf.getBackend() === 'webgl' || tf.getBackend() === 'tensorflow';
        if (gpuAvailable) {
          console.log('🚀 [LOCAL-ML] GPU acceleration enabled');
        } else {
          console.log('⚠️ [LOCAL-ML] GPU requested but not available, using CPU');
        }
      }

      // Set memory growth to avoid OOM errors
      tf.env().set('WEBGL_PACK', false);
      tf.env().set('WEBGL_FORCE_F16_TEXTURES', true);
      
      console.log(`🔧 [LOCAL-ML] TensorFlow backend: ${tf.getBackend()}`);
    } catch (error) {
      console.warn('⚠️ [LOCAL-ML] Could not configure TensorFlow:', error);
    }
  }

  /**
   * Load or create ML models
   */
  private async loadModels(): Promise<void> {
    try {
      switch (this.config.modelType) {
        case 'graph_neural_network':
          await this.loadGraphNeuralNetwork();
          break;
        case 'sequence_classifier':
          await this.loadSequenceClassifier();
          break;
        case 'quality_scorer':
          await this.loadQualityScorer();
          break;
        case 'custom':
          await this.loadCustomModel();
          break;
        default:
          throw new Error(`Unsupported model type: ${this.config.modelType}`);
      }
    } catch (error) {
      console.error('❌ [LOCAL-ML] Error loading models:', error);
      throw error;
    }
  }

  /**
   * Load a Graph Neural Network model for network analysis
   */
  private async loadGraphNeuralNetwork(): Promise<void> {
    console.log('🧠 [LOCAL-ML] Loading Graph Neural Network model...');
    
    try {
      // Create a simple GNN model for trail network analysis
      const model = tf.sequential({
        layers: [
          // Input layer for node features
          tf.layers.dense({
            inputShape: [null, 7], // 7 node features
            units: 64,
            activation: 'relu',
            name: 'node_input'
          }),
          
          // Graph convolution layer (simplified)
          tf.layers.dense({
            units: 32,
            activation: 'relu',
            name: 'graph_conv_1'
          }),
          
          // Attention mechanism
          tf.layers.dense({
            units: 16,
            activation: 'tanh',
            name: 'attention'
          }),
          
          // Output layer for predictions
          tf.layers.dense({
            units: 1,
            activation: 'sigmoid',
            name: 'output'
          })
        ]
      });

      // Compile the model
      model.compile({
        optimizer: 'adam',
        loss: 'binaryCrossentropy',
        metrics: ['accuracy']
      });

      this.models.set('gnn', model);
      console.log('✅ [LOCAL-ML] Graph Neural Network model loaded');
    } catch (error) {
      console.error('❌ [LOCAL-ML] Error loading GNN model:', error);
      throw error;
    }
  }

  /**
   * Load a sequence classifier for trail pattern analysis
   */
  private async loadSequenceClassifier(): Promise<void> {
    console.log('📊 [LOCAL-ML] Loading sequence classifier model...');
    
    try {
      // Create a sequence model for trail pattern classification
      const model = tf.sequential({
        layers: [
          // Input layer for sequence data
          tf.layers.lstm({
            inputShape: [this.config.maxSequenceLength, 5], // 5 features per timestep
            units: 50,
            returnSequences: true,
            name: 'lstm_1'
          }),
          
          // Second LSTM layer
          tf.layers.lstm({
            units: 25,
            returnSequences: false,
            name: 'lstm_2'
          }),
          
          // Dense layers
          tf.layers.dense({
            units: 16,
            activation: 'relu',
            name: 'dense_1'
          }),
          
          // Output layer
          tf.layers.dense({
            units: 3, // 3 classes: good, fair, poor
            activation: 'softmax',
            name: 'classification_output'
          })
        ]
      });

      // Compile the model
      model.compile({
        optimizer: 'adam',
        loss: 'categoricalCrossentropy',
        metrics: ['accuracy']
      });

      this.models.set('sequence_classifier', model);
      console.log('✅ [LOCAL-ML] Sequence classifier model loaded');
    } catch (error) {
      console.error('❌ [LOCAL-ML] Error loading sequence classifier:', error);
      throw error;
    }
  }

  /**
   * Load a quality scorer for loop recommendations
   */
  private async loadQualityScorer(): Promise<void> {
    console.log('⭐ [LOCAL-ML] Loading quality scorer model...');
    
    try {
      // Create a quality scoring model
      const model = tf.sequential({
        layers: [
          // Input layer for loop features
          tf.layers.dense({
            inputShape: [10], // 10 loop features
            units: 32,
            activation: 'relu',
            name: 'input_layer'
          }),
          
          // Hidden layers
          tf.layers.dense({
            units: 16,
            activation: 'relu',
            name: 'hidden_1'
          }),
          
          tf.layers.dense({
            units: 8,
            activation: 'relu',
            name: 'hidden_2'
          }),
          
          // Output layer for quality score (0-1)
          tf.layers.dense({
            units: 1,
            activation: 'sigmoid',
            name: 'quality_output'
          })
        ]
      });

      // Compile the model
      model.compile({
        optimizer: 'adam',
        loss: 'meanSquaredError',
        metrics: ['mae']
      });

      this.models.set('quality_scorer', model);
      console.log('✅ [LOCAL-ML] Quality scorer model loaded');
    } catch (error) {
      console.error('❌ [LOCAL-ML] Error loading quality scorer:', error);
      throw error;
    }
  }

  /**
   * Load a custom model from file
   */
  private async loadCustomModel(): Promise<void> {
    console.log('🔧 [LOCAL-ML] Loading custom model...');
    
    try {
      if (!this.config.modelPath) {
        throw new Error('Model path required for custom model type');
      }

      // Load model from file
      const model = await tf.loadLayersModel(`file://${this.config.modelPath}`);
      this.models.set('custom', model);
      console.log('✅ [LOCAL-ML] Custom model loaded from:', this.config.modelPath);
    } catch (error) {
      console.error('❌ [LOCAL-ML] Error loading custom model:', error);
      throw error;
    }
  }

  /**
   * Run inference on trail network data
   */
  async runInference(input: ModelInput): Promise<ModelOutput> {
    if (!this.isInitialized) {
      throw new Error('ML model service not initialized. Call initialize() first.');
    }

    console.log('🔮 [LOCAL-ML] Running inference on trail network data...');

    try {
      const results: ModelOutput = {
        predictions: [],
        confidence: [],
        embeddings: [],
        attentionWeights: []
      };

      // Process based on model type
      switch (this.config.modelType) {
        case 'graph_neural_network':
          return await this.runGNNInference(input);
        case 'sequence_classifier':
          return await this.runSequenceInference(input);
        case 'quality_scorer':
          return await this.runQualityInference(input);
        case 'custom':
          return await this.runCustomInference(input);
        default:
          throw new Error(`Unsupported model type: ${this.config.modelType}`);
      }
    } catch (error) {
      console.error('❌ [LOCAL-ML] Error running inference:', error);
      throw error;
    }
  }

  /**
   * Run Graph Neural Network inference
   */
  private async runGNNInference(input: ModelInput): Promise<ModelOutput> {
    const model = this.models.get('gnn');
    if (!model) {
      throw new Error('GNN model not loaded');
    }

    try {
      // Prepare input tensors
      const nodeFeaturesTensor = tf.tensor3d([input.nodeFeatures]);
      const adjacencyTensor = tf.tensor3d([input.adjacencyMatrix]);

      // Run inference
      const predictions = model.predict([nodeFeaturesTensor, adjacencyTensor]) as tf.Tensor;
      const predictionsArray = await predictions.data();

      // Clean up tensors
      nodeFeaturesTensor.dispose();
      adjacencyTensor.dispose();
      predictions.dispose();

      return {
        predictions: Array.from(predictionsArray),
        confidence: Array.from(predictionsArray).map(p => Math.abs(p - 0.5) * 2), // Convert to confidence
        embeddings: input.nodeFeatures // Return node features as embeddings for now
      };
    } catch (error) {
      console.error('❌ [LOCAL-ML] Error in GNN inference:', error);
      throw error;
    }
  }

  /**
   * Run sequence classifier inference
   */
  private async runSequenceInference(input: ModelInput): Promise<ModelOutput> {
    const model = this.models.get('sequence_classifier');
    if (!model) {
      throw new Error('Sequence classifier model not loaded');
    }

    try {
      if (!input.sequenceData) {
        throw new Error('Sequence data required for sequence classifier');
      }

      // Pad or truncate sequence to max length
      const paddedSequence = this.padSequence(input.sequenceData, this.config.maxSequenceLength);
      const sequenceTensor = tf.tensor3d([paddedSequence]);

      // Run inference
      const predictions = model.predict(sequenceTensor) as tf.Tensor;
      const predictionsArray = await predictions.data();

      // Clean up tensors
      sequenceTensor.dispose();
      predictions.dispose();

      return {
        predictions: Array.from(predictionsArray),
        confidence: Array.from(predictionsArray).map(p => Math.max(...p)), // Max probability as confidence
      };
    } catch (error) {
      console.error('❌ [LOCAL-ML] Error in sequence inference:', error);
      throw error;
    }
  }

  /**
   * Run quality scorer inference
   */
  private async runQualityInference(input: ModelInput): Promise<ModelOutput> {
    const model = this.models.get('quality_scorer');
    if (!model) {
      throw new Error('Quality scorer model not loaded');
    }

    try {
      // Extract loop features from input
      const loopFeatures = this.extractLoopFeatures(input);
      const featuresTensor = tf.tensor2d([loopFeatures]);

      // Run inference
      const predictions = model.predict(featuresTensor) as tf.Tensor;
      const predictionsArray = await predictions.data();

      // Clean up tensors
      featuresTensor.dispose();
      predictions.dispose();

      const qualityScore = predictionsArray[0];
      const confidence = Math.abs(qualityScore - 0.5) * 2; // Convert to confidence

      return {
        predictions: [qualityScore],
        confidence: [confidence],
      };
    } catch (error) {
      console.error('❌ [LOCAL-ML] Error in quality inference:', error);
      throw error;
    }
  }

  /**
   * Run custom model inference
   */
  private async runCustomInference(input: ModelInput): Promise<ModelOutput> {
    const model = this.models.get('custom');
    if (!model) {
      throw new Error('Custom model not loaded');
    }

    try {
      // This would depend on the specific custom model
      // For now, return a placeholder
      return {
        predictions: [0.5],
        confidence: [0.5],
      };
    } catch (error) {
      console.error('❌ [LOCAL-ML] Error in custom inference:', error);
      throw error;
    }
  }

  /**
   * Pad or truncate sequence to specified length
   */
  private padSequence(sequence: number[][], maxLength: number): number[][] {
    if (sequence.length >= maxLength) {
      return sequence.slice(0, maxLength);
    }

    // Pad with zeros
    const padded = [...sequence];
    while (padded.length < maxLength) {
      padded.push(new Array(sequence[0]?.length || 5).fill(0));
    }

    return padded;
  }

  /**
   * Extract loop features for quality scoring
   */
  private extractLoopFeatures(input: ModelInput): number[] {
    // Extract 10 features for loop quality scoring
    const features: number[] = [];

    // Basic metrics
    features.push(input.nodeFeatures.length); // Number of nodes
    features.push(input.edgeFeatures.length); // Number of edges

    // Average node features
    if (input.nodeFeatures.length > 0) {
      const avgNodeFeatures = input.nodeFeatures[0].map((_, i) => 
        input.nodeFeatures.reduce((sum, features) => sum + features[i], 0) / input.nodeFeatures.length
      );
      features.push(...avgNodeFeatures.slice(0, 5)); // Take first 5 features
    } else {
      features.push(...new Array(5).fill(0));
    }

    // Average edge features
    if (input.edgeFeatures.length > 0) {
      const avgEdgeFeatures = input.edgeFeatures[0].map((_, i) => 
        input.edgeFeatures.reduce((sum, features) => sum + features[i], 0) / input.edgeFeatures.length
      );
      features.push(...avgEdgeFeatures.slice(0, 3)); // Take first 3 features
    } else {
      features.push(...new Array(3).fill(0));
    }

    return features;
  }

  /**
   * Train a model on trail data (for fine-tuning)
   */
  async trainModel(trainingData: ModelInput[], labels: number[], epochs: number = 10): Promise<void> {
    if (!this.isInitialized) {
      throw new Error('ML model service not initialized. Call initialize() first.');
    }

    console.log(`🎓 [LOCAL-ML] Training model for ${epochs} epochs...`);

    try {
      const model = this.models.get(this.config.modelType);
      if (!model) {
        throw new Error(`Model ${this.config.modelType} not loaded`);
      }

      // Prepare training data
      const inputs = this.prepareTrainingInputs(trainingData);
      const targets = tf.tensor2d(labels.map(label => [label]));

      // Train the model
      const history = await model.fit(inputs, targets, {
        epochs,
        batchSize: this.config.batchSize,
        validationSplit: 0.2,
        verbose: 1
      });

      // Clean up tensors
      inputs.dispose();
      targets.dispose();

      console.log('✅ [LOCAL-ML] Model training completed');
      console.log(`📊 [LOCAL-ML] Final loss: ${history.history.loss[epochs - 1]?.toFixed(4)}`);
    } catch (error) {
      console.error('❌ [LOCAL-ML] Error training model:', error);
      throw error;
    }
  }

  /**
   * Prepare training inputs based on model type
   */
  private prepareTrainingInputs(trainingData: ModelInput[]): tf.Tensor {
    switch (this.config.modelType) {
      case 'graph_neural_network':
        return tf.tensor3d(trainingData.map(data => data.nodeFeatures));
      case 'sequence_classifier':
        const sequences = trainingData.map(data => 
          this.padSequence(data.sequenceData || [], this.config.maxSequenceLength)
        );
        return tf.tensor3d(sequences);
      case 'quality_scorer':
        const features = trainingData.map(data => this.extractLoopFeatures(data));
        return tf.tensor2d(features);
      default:
        throw new Error(`Unsupported model type for training: ${this.config.modelType}`);
    }
  }

  /**
   * Save trained model to file
   */
  async saveModel(modelPath: string): Promise<void> {
    if (!this.isInitialized) {
      throw new Error('ML model service not initialized. Call initialize() first.');
    }

    console.log(`💾 [LOCAL-ML] Saving model to: ${modelPath}`);

    try {
      const model = this.models.get(this.config.modelType);
      if (!model) {
        throw new Error(`Model ${this.config.modelType} not loaded`);
      }

      await model.save(`file://${modelPath}`);
      console.log('✅ [LOCAL-ML] Model saved successfully');
    } catch (error) {
      console.error('❌ [LOCAL-ML] Error saving model:', error);
      throw error;
    }
  }

  /**
   * Get model information
   */
  getModelInfo(): any {
    if (!this.isInitialized) {
      throw new Error('ML model service not initialized. Call initialize() first.');
    }

    const model = this.models.get(this.config.modelType);
    if (!model) {
      return { error: 'Model not loaded' };
    }

    return {
      modelType: this.config.modelType,
      inputShape: model.inputShape,
      outputShape: model.outputShape,
      trainableParams: model.countParams(),
      config: this.config
    };
  }

  /**
   * Clean up resources
   */
  dispose(): void {
    console.log('🧹 [LOCAL-ML] Disposing ML model service...');
    
    // Dispose all models
    for (const [name, model] of this.models) {
      try {
        model.dispose();
        console.log(`🗑️ [LOCAL-ML] Disposed model: ${name}`);
      } catch (error) {
        console.warn(`⚠️ [LOCAL-ML] Error disposing model ${name}:`, error);
      }
    }
    
    this.models.clear();
    this.isInitialized = false;
    console.log('✅ [LOCAL-ML] ML model service disposed');
  }
}
