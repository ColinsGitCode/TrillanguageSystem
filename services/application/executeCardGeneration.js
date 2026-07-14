'use strict';

const path = require('node:path');
const { cardGenerationPorts } = require('./cardGenerationPorts');
const { CardAdmissionError, normalizeDuplicatePolicy } = require('./cardAdmission');

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
    duplicatePolicy: normalizeDuplicatePolicy(command.duplicatePolicy),
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
    let staging = null;
    let publishedPaths = [];
    let generationId = null;
    try {
      normalizedCommand = normalizeCommand(command, ports);
      const {
        phrase,
        cardType,
        sourceMode,
        targetFolder,
        duplicatePolicy,
        requestedProvider,
        modelOverride,
      } = normalizedCommand;
      const perf = context.performanceMonitor || ports.createPerformanceMonitor();
      const e2eTestMode = context.e2eTestMode ?? ports.e2eTestMode;
      const duplicates = ports.findDuplicateGenerations(phrase, cardType);
      const duplicateAdmission = ports.assertDuplicatePolicy({ cardType, duplicates, duplicatePolicy });

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

      staging = ports.createGenerationStagingArea({ targetDir, folderName, baseName });
      perf.mark('fileSave');
      const stagedResult = ports.saveGeneratedFiles(phrase, content, {
        baseName,
        targetDir: staging.stagingDir,
        folderName,
        cardType,
        sourceMode,
      });

      let audio = null;
      let persistedAudioTasks = [];
      if (!e2eTestMode && ports.hasTtsEndpoint() && content.audio_tasks.length) {
        const audioTasks = ports.normalizeAudioTasks(content.audio_tasks, stagedResult.baseName);
        audio = await ports.generateAudioBatch(audioTasks, {
          outputDir: stagedResult.targetDir,
          baseName: stagedResult.baseName,
        });
      }

      const normalizedAudioTasks = ports.normalizeAudioTasks(content.audio_tasks, stagedResult.baseName);
      const admission = ports.validateCardAdmission({
        generation: {
          phrase,
          cardType,
          sourceMode,
          markdownContent: content.markdown_content,
        },
        audioTasks: normalizedAudioTasks,
        audio,
        e2eTestMode,
        ttsConfigured: ports.hasTtsEndpoint(),
      });

      const published = ports.publishStagedGeneration(staging);
      publishedPaths = published.publishedPaths;
      const result = {
        ...stagedResult,
        targetDir,
        absPaths: published.absPaths,
      };
      if (audio) {
        audio = {
          ...audio,
          results: (audio.results || []).map((item) => ({
            ...item,
            filePath: path.join(targetDir, path.basename(item.filePath)),
          })),
        };
      }
      persistedAudioTasks = ports.buildPersistedAudioTasks(normalizedAudioTasks, audio);

      perf.mark('audioGenerate');
      observability.performance = perf.end();

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
        dbData.cardTags = ports.buildAdmissionTags(dbData.generation);
        if (dbData.cardTags.some((tag) => tag.namespace === 'qa' && tag.normalizedValue === 'test-artifact-candidate')) {
          admission.status = 'review-required';
        }
        dbData.learningAdmission = {
          status: admission.status === 'review-required' ? 'unresolved' : 'eligible',
          contentHash: admission.contentHash,
          reasons: admission.status === 'review-required'
            ? ['test-artifact-review-pending']
            : ['online-admission-passed'],
          decisionVersion: 'card-admission-v1',
          stateVersion: 'learning-admission-v1',
          disposition: admission.status === 'review-required' ? 'exclude' : 'create-items',
        };
        generationId = ports.insertGeneration(dbData);
        ports.validatePersistedAdmission({
          generation: ports.getGenerationById(generationId),
          tags: ports.listCardTags(generationId),
          expectedHash: admission.contentHash,
          expectedAudioRows: e2eTestMode ? 0 : normalizedAudioTasks.length,
        });
        ports.log.info({ generationId }, 'inserted generation');
      } catch (dbError) {
        ports.log.error({ err: dbError }, 'database insert failed');
        throw dbError;
      }

      return {
        success: true,
        card_type: cardType,
        source_mode: sourceMode,
        provider_requested: requestedProvider,
        provider_used: providerUsed,
        fallback: generation.fallback || null,
        duplicate_policy: duplicateAdmission.policy,
        generationId,
        result,
        audio,
        prompt,
        llm_output: content,
        observability,
        admission,
      };
    } catch (error) {
      if (generationId) {
        try {
          ports.deleteGeneration(generationId);
        } catch (cleanupError) {
          ports.log.error({ err: cleanupError, generationId }, 'failed to roll back rejected generation');
        }
      }
      try {
        ports.cleanupGenerationArtifacts({
          stagingDir: staging?.stagingDir,
          stagingRoot: staging?.stagingRoot,
          publishedPaths,
        });
      } catch (cleanupError) {
        ports.log.error({ err: cleanupError }, 'failed to clean rejected generation files');
      }
      if (
        !(error instanceof GenerationCommandError)
        && !(error instanceof GenerationValidationError)
        && !(error instanceof CardAdmissionError)
      ) {
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
  CardAdmissionError,
};
