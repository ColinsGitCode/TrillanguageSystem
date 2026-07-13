'use strict';

const { cardGenerationPorts } = require('./cardGenerationPorts');

class GenerationCommandError extends Error {
  constructor(message) {
    super(message);
    this.name = 'GenerationCommandError';
    this.code = 'GENERATION_COMMAND_INVALID';
    this.status = 400;
  }
}

class GenerationValidationError extends Error {
  constructor(details, prompt, llmOutput) {
    super('Validation failed');
    this.name = 'GenerationValidationError';
    this.code = 'GENERATION_VALIDATION_FAILED';
    this.status = 422;
    this.details = details;
    this.prompt = prompt;
    this.llmOutput = llmOutput;
  }
}

function normalizeCommand(command, ports) {
  const phrase = String(command?.phrase || '').trim();
  if (!phrase) throw new GenerationCommandError('Phrase required');

  return {
    phrase,
    cardType: ports.normalizeCardType(command.cardType),
    sourceMode: ports.normalizeSourceMode(command.sourceMode),
    targetFolder: String(command.targetFolder || '').trim(),
    requestedProvider: command.requestedProvider || ports.activeProvider,
    modelOverride: command.modelOverride || ports.defaultModel,
  };
}

function recordExecutionError(ports, command, error) {
  try {
    ports.insertError({
      phrase: command?.phrase || 'unknown',
      llmProvider: command?.requestedProvider || ports.activeProvider,
      requestId: null,
      errorType: error.name || 'UnknownError',
      errorMessage: error.message,
      errorStack: error.stack,
      prompt: null,
      llmResponse: null,
      validationErrors: null,
    });
  } catch (dbError) {
    ports.log.error({ err: dbError }, 'error insert failed');
  }
}

function createCardGenerationUseCase(customPorts = {}) {
  const ports = { ...cardGenerationPorts, ...customPorts };

  return async function executeCardGeneration(command, context = {}) {
    let normalizedCommand;
    try {
      normalizedCommand = normalizeCommand(command, ports);
      const {
        phrase,
        cardType,
        sourceMode,
        targetFolder,
        requestedProvider,
        modelOverride,
      } = normalizedCommand;
      const perf = context.performanceMonitor || ports.createPerformanceMonitor();
      const e2eTestMode = context.e2eTestMode ?? ports.e2eTestMode;

      const generation = e2eTestMode
        ? ports.buildFixtureResult({ phrase, cardType, requestedProvider, sourceMode })
        : await ports.generateWithProvider(phrase, requestedProvider, perf, {
            targetFolder,
            cardType,
            sourceMode,
            modelOverride,
          });
      const { output: content, prompt, observability, baseName, targetDir, folderName } = generation;
      const providerUsed = observability?.metadata?.provider || requestedProvider;

      ports.postProcessGeneratedContent(content);
      const validationErrors = ports.validateGeneratedContent(content, {
        allowMissingHtml: true,
        cardType,
      });
      if (validationErrors.length) {
        throw new GenerationValidationError(validationErrors, prompt, content);
      }

      content.audio_tasks = ports.resolveCardAudioTasks(content, cardType);
      const preparedMarkdown = await ports.prepareMarkdownForCard(content.markdown_content, {
        baseName,
        audioTasks: content.audio_tasks,
      });
      content.markdown_content = preparedMarkdown;
      content.html_content = await ports.renderHtmlFromMarkdown(preparedMarkdown, {
        baseName,
        audioTasks: content.audio_tasks,
      });

      perf.mark('fileSave');
      const result = ports.saveGeneratedFiles(phrase, content, {
        baseName,
        targetDir,
        folderName,
        cardType,
        sourceMode,
      });

      let audio = null;
      let persistedAudioTasks = [];
      if (!e2eTestMode && ports.hasTtsEndpoint() && content.audio_tasks.length) {
        const audioTasks = ports.normalizeAudioTasks(content.audio_tasks, result.baseName);
        audio = await ports.generateAudioBatch(audioTasks, {
          outputDir: result.targetDir,
          baseName: result.baseName,
        });
        persistedAudioTasks = ports.buildPersistedAudioTasks(audioTasks, audio);
      }

      perf.mark('audioGenerate');
      observability.performance = perf.end();

      let generationId = null;
      try {
        const dbData = ports.prepareInsertData({
          phrase,
          provider: providerUsed,
          model: observability.metadata?.model || providerUsed,
          folderName,
          baseName: result.baseName,
          filePaths: {
            md: result.absPaths.md,
            html: result.absPaths.html,
            meta: result.absPaths.meta,
          },
          content,
          observability,
          prompt,
          audioTasks: persistedAudioTasks,
          cardType,
          sourceMode,
        });
        generationId = ports.insertGeneration(dbData);
        ports.log.info({ generationId }, 'inserted generation');
      } catch (dbError) {
        ports.log.error({ err: dbError }, 'database insert failed');
      }

      return {
        success: true,
        card_type: cardType,
        source_mode: sourceMode,
        provider_requested: requestedProvider,
        provider_used: providerUsed,
        fallback: generation.fallback || null,
        generationId,
        result,
        audio,
        prompt,
        llm_output: content,
        observability,
      };
    } catch (error) {
      if (!(error instanceof GenerationCommandError) && !(error instanceof GenerationValidationError)) {
        recordExecutionError(ports, normalizedCommand || command, error);
      }
      throw error;
    }
  };
}

const executeCardGeneration = createCardGenerationUseCase();

module.exports = {
  executeCardGeneration,
  createCardGenerationUseCase,
  GenerationCommandError,
  GenerationValidationError,
};
