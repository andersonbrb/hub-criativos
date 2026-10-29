import Anthropic from '@anthropic-ai/sdk';
import type { EditingStandardRepository, ProductionLine, ProductionStage } from '@sbs/studio';

import {
  HubElevenLabs,
  HubFlora,
  HubHeygen,
  HubTranscriber,
  type VideoRenderer,
} from '../../infrastructure/integrations/hub-tools';
import { VmakeClient } from '../../infrastructure/integrations/vmake-client';
import type { IntegrationsService } from '../integrations';
import type { MediaStorage } from '../media-storage';
import { ClaudeJudge } from './claude-judges';
import { ClaudeEditingAgents } from './editing-agents';
import { editingStage } from './editing-stage';
import { imagesStage } from './images-stage';
import { ingestStage } from './ingest-stage';
import { subtitleStage } from './subtitle-stage';
import { translationStages, type ProductionTools } from './translation-stages';

/**
 * Monta as ferramentas a partir do que está conectado no hub (lido a cada produção): HeyGen, ElevenLabs e FLORA
 * pelos logins das contas, Claude e vMake pelas chaves coladas em Integrações.
 */
export function productionTools(deps: {
  integrations: Pick<IntegrationsService, 'credentials'>;
  media: MediaStorage;
  editingStandards: Pick<EditingStandardRepository, 'get'>;
  renderer?: VideoRenderer | null;
  /** Transcrição (o hub sempre tem; os testes trocam). */
  transcriber?: HubTranscriber | null;
  fetch?: typeof fetch;
}): ProductionTools {
  const { integrations, media } = deps;
  const fetchFn = deps.fetch ?? fetch;
  const connected = async (id: 'heygen' | 'elevenlabs' | 'flora') => (await integrations.credentials(id)) !== null;
  const anthropicKey = async () => (await integrations.credentials('anthropic'))?.['apiKey'] ?? null;
  return {
    media,
    fetch: fetchFn,
    heygen: async () => ((await connected('heygen')) ? new HubHeygen(media) : null),
    elevenlabs: async () => ((await connected('elevenlabs')) ? new HubElevenLabs(media) : null),
    transcriber: async () => (deps.transcriber === undefined ? new HubTranscriber(media) : deps.transcriber),
    vmake: async () => {
      const creds = await integrations.credentials('vmake');
      return creds?.['accessKey'] && creds['secretKey']
        ? new VmakeClient(
            { accessKey: creds['accessKey'], secretKey: creds['secretKey'] },
            { fetch: fetchFn },
          )
        : null;
    },
    flora: async () => ((await connected('flora')) ? new HubFlora(media, fetchFn) : null),
    judge: async () => {
      const apiKey = await anthropicKey();
      return apiKey ? new ClaudeJudge(new Anthropic({ apiKey })) : null;
    },
    editing: async () => {
      const apiKey = await anthropicKey();
      return apiKey ? new ClaudeEditingAgents(new Anthropic({ apiKey })) : null;
    },
    editingStandard: async () => {
      const standard = await deps.editingStandards.get();
      return { guidelines: { ...standard.guidelines }, style: { ...standard.style } };
    },
    renderer: deps.renderer ?? null,
  };
}

/**
 * As etapas de produção (especialista + revisor) por formato. Reel: armazenamento → remoção de
 * legendas (vMake) → tradução (HeyGen ou ElevenLabs) → edição (Remotion) → capa (FLORA).
 * Carrossel: armazenamento → slides (FLORA). Ferramenta nova entra aqui como mais uma etapa.
 */
export function productionLine(tools: ProductionTools | (() => ProductionTools)): ProductionLine {
  return {
    async stagesFor(format): Promise<ProductionStage[]> {
      const current = typeof tools === 'function' ? tools() : tools;
      const stages = [ingestStage(current.media, current.fetch)];
      if (format === 'reel') {
        stages.push(subtitleStage(current), ...translationStages(current), editingStage(current));
      }
      stages.push(imagesStage(current));
      return stages;
    },
  };
}
