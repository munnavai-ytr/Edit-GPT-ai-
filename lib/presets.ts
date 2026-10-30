import {
  CaptionStyleConfig,
  ColorGradeConfig,
  EditingPresetId,
} from './types';

export interface EditingPresetDefinition {
  id: EditingPresetId;
  name: string;
  tagline: string;
  targetSceneSeconds: [number, number];
  pacingDescription: string;
  colorGrade: ColorGradeConfig;
  captionStyle: Omit<CaptionStyleConfig, 'enabled' | 'fontFamily'>;
  preferredTransitions: string[];
  preferredZooms: string[];
  sfxDefault: boolean;
  musicVolumeDefault: number;
  aiPromptGuidance: string;
}

export const EDITING_PRESETS: Record<EditingPresetId, EditingPresetDefinition> = {
  auto: {
    id: 'auto',
    name: 'Auto Style',
    tagline: 'Adapts pacing, framing, and captions to voiceover tone automatically',
    targetSceneSeconds: [2.2, 4.2],
    pacingDescription: 'Balanced dynamic cuts matched to natural speech phrasing',
    colorGrade: {
      preset: 'clean_bright',
      contrast: 1.05,
      brightness: 0.01,
      saturation: 1.08,
    },
    captionStyle: {
      stylePreset: 'hormozi_bold',
      position: 'bottom_safe',
      fontSize: 56,
      primaryColor: '#FFFFFF',
      highlightColor: '#38BDF8',
      backgroundColor: '#060B16',
      backgroundOpacity: 0.65,
      strokeColor: '#000000',
      strokeWidth: 5,
      shadowOpacity: 0.7,
      animation: 'pop',
    },
    preferredTransitions: ['cut', 'fade'],
    preferredZooms: ['zoom_in_slow', 'zoom_out_slow', 'pan_left_right'],
    sfxDefault: true,
    musicVolumeDefault: 0.16,
    aiPromptGuidance:
      'Analyze the emotional tone and topic of the voiceover first. Use brisk cuts on strong hooks, clean breathing room on explanations, and highlight key impact nouns/verbs.',
  },
  cinematic: {
    id: 'cinematic',
    name: 'Cinematic',
    tagline: 'Rich contrast, deliberate camera motion, and understated typography',
    targetSceneSeconds: [3.2, 5.5],
    pacingDescription: 'Measured cinematic cuts with slow push-ins and dissolves',
    colorGrade: {
      preset: 'cinematic_warm',
      contrast: 1.12,
      brightness: -0.01,
      saturation: 1.1,
    },
    captionStyle: {
      stylePreset: 'minimal_stroke',
      position: 'bottom_safe',
      fontSize: 48,
      primaryColor: '#F8FAFC',
      highlightColor: '#FBBF24',
      backgroundColor: '#000000',
      backgroundOpacity: 0.35,
      strokeColor: '#000000',
      strokeWidth: 4,
      shadowOpacity: 0.85,
      animation: 'fade',
    },
    preferredTransitions: ['fade', 'dissolve', 'cut'],
    preferredZooms: ['zoom_in_slow', 'zoom_out_slow'],
    sfxDefault: true,
    musicVolumeDefault: 0.2,
    aiPromptGuidance:
      'Favor longer atmospheric holds, smooth dissolves on emotional shifts, slow push-in/pull-out camera motion, and refined minimal captions.',
  },
  documentary: {
    id: 'documentary',
    name: 'Documentary',
    tagline: 'Authentic visual storytelling grounded in clear narrative flow',
    targetSceneSeconds: [3.0, 5.0],
    pacingDescription: 'Story-driven B-roll cuts synchronized with factual claims',
    colorGrade: {
      preset: 'cool_crisp',
      contrast: 1.08,
      brightness: 0.0,
      saturation: 1.02,
    },
    captionStyle: {
      stylePreset: 'clean_boxed',
      position: 'bottom_safe',
      fontSize: 50,
      primaryColor: '#FFFFFF',
      highlightColor: '#60A5FA',
      backgroundColor: '#090E1A',
      backgroundOpacity: 0.78,
      strokeColor: '#000000',
      strokeWidth: 3,
      shadowOpacity: 0.6,
      animation: 'fade',
    },
    preferredTransitions: ['cut', 'dissolve'],
    preferredZooms: ['zoom_in_slow', 'pan_left_right', 'pan_right_left'],
    sfxDefault: false,
    musicVolumeDefault: 0.15,
    aiPromptGuidance:
      'Match spoken facts directly to visual evidence in the assets. Use gentle Ken Burns pans on photos and clean straight cuts.',
  },
  business: {
    id: 'business',
    name: 'Professional Business',
    tagline: 'Executive clarity, structured framing, and crisp readable captions',
    targetSceneSeconds: [2.8, 4.5],
    pacingDescription: 'Confident, structured cuts aligned with key value points',
    colorGrade: {
      preset: 'clean_bright',
      contrast: 1.06,
      brightness: 0.02,
      saturation: 1.04,
    },
    captionStyle: {
      stylePreset: 'clean_boxed',
      position: 'bottom_safe',
      fontSize: 52,
      primaryColor: '#FFFFFF',
      highlightColor: '#3B82F6',
      backgroundColor: '#0B1120',
      backgroundOpacity: 0.82,
      strokeColor: '#000000',
      strokeWidth: 3,
      shadowOpacity: 0.5,
      animation: 'slide_up',
    },
    preferredTransitions: ['cut', 'fade'],
    preferredZooms: ['zoom_in_slow', 'none'],
    sfxDefault: false,
    musicVolumeDefault: 0.12,
    aiPromptGuidance:
      'Maintain polished authority. Avoid flashy transitions or aggressive zooms. Emphasize metrics, key terms, and clean framing.',
  },
  educational: {
    id: 'educational',
    name: 'Educational',
    tagline: 'High-retention visual explanations with clear keyword emphasis',
    targetSceneSeconds: [2.4, 4.0],
    pacingDescription: 'Clear step-by-step visual changes per concept',
    colorGrade: {
      preset: 'clean_bright',
      contrast: 1.05,
      brightness: 0.02,
      saturation: 1.08,
    },
    captionStyle: {
      stylePreset: 'clean_boxed',
      position: 'bottom_safe',
      fontSize: 54,
      primaryColor: '#FFFFFF',
      highlightColor: '#34D399',
      backgroundColor: '#060B16',
      backgroundOpacity: 0.8,
      strokeColor: '#000000',
      strokeWidth: 4,
      shadowOpacity: 0.65,
      animation: 'pop',
    },
    preferredTransitions: ['cut', 'slideup'],
    preferredZooms: ['zoom_in_slow', 'zoom_in_punch'],
    sfxDefault: true,
    musicVolumeDefault: 0.13,
    aiPromptGuidance:
      'Change visual angle or framing whenever a new step, concept, or example is introduced. Highlight key educational terms.',
  },
  storytelling: {
    id: 'storytelling',
    name: 'Storytelling',
    tagline: 'Emotional pacing that builds tension from hook to resolution',
    targetSceneSeconds: [2.5, 4.8],
    pacingDescription: 'Expressive rhythm following narrative tension and pauses',
    colorGrade: {
      preset: 'cinematic_warm',
      contrast: 1.1,
      brightness: 0.0,
      saturation: 1.12,
    },
    captionStyle: {
      stylePreset: 'hormozi_bold',
      position: 'bottom_safe',
      fontSize: 54,
      primaryColor: '#FFFFFF',
      highlightColor: '#F59E0B',
      backgroundColor: '#090D16',
      backgroundOpacity: 0.55,
      strokeColor: '#000000',
      strokeWidth: 5,
      shadowOpacity: 0.8,
      animation: 'pop',
    },
    preferredTransitions: ['cut', 'fade', 'dissolve'],
    preferredZooms: ['zoom_in_slow', 'zoom_out_slow', 'pan_left_right'],
    sfxDefault: true,
    musicVolumeDefault: 0.18,
    aiPromptGuidance:
      'Structure scenes around the narrative hook, rising conflict/curiosity, and memorable payoff. Use slow zooms on emotional sentences.',
  },
  viral_fast: {
    id: 'viral_fast',
    name: 'Fast-Paced Viral Shorts',
    tagline: 'Rapid pattern interrupts, punchy zooms, and bold word highlights',
    targetSceneSeconds: [1.4, 2.8],
    pacingDescription: 'High-retention micro-cuts every 1.5 to 2.8 seconds',
    colorGrade: {
      preset: 'vibrant',
      contrast: 1.12,
      brightness: 0.02,
      saturation: 1.18,
    },
    captionStyle: {
      stylePreset: 'hormozi_bold',
      position: 'middle_center',
      fontSize: 62,
      primaryColor: '#FFFFFF',
      highlightColor: '#FACC15',
      backgroundColor: '#000000',
      backgroundOpacity: 0.5,
      strokeColor: '#000000',
      strokeWidth: 6,
      shadowOpacity: 0.85,
      animation: 'pop',
    },
    preferredTransitions: ['cut', 'wipeleft'],
    preferredZooms: ['zoom_in_punch', 'zoom_in_slow', 'zoom_out_slow'],
    sfxDefault: true,
    musicVolumeDefault: 0.18,
    aiPromptGuidance:
      'Keep visual momentum high with frequent framing shifts, punch-in zooms on strong hook words, and energetic pacing without cutting off speech.',
  },
  minimal_clean: {
    id: 'minimal_clean',
    name: 'Minimal Clean',
    tagline: 'Calm aesthetic, zero clutter, natural colors, and quiet subtitles',
    targetSceneSeconds: [3.2, 5.2],
    pacingDescription: 'Unrushed straight cuts with subtle motion',
    colorGrade: {
      preset: 'neutral',
      contrast: 1.02,
      brightness: 0.01,
      saturation: 1.0,
    },
    captionStyle: {
      stylePreset: 'editorial_clean',
      position: 'bottom_safe',
      fontSize: 46,
      primaryColor: '#F8FAFC',
      highlightColor: '#93C5FD',
      backgroundColor: '#000000',
      backgroundOpacity: 0.4,
      strokeColor: '#000000',
      strokeWidth: 3,
      shadowOpacity: 0.6,
      animation: 'fade',
    },
    preferredTransitions: ['cut', 'fade'],
    preferredZooms: ['zoom_in_slow', 'none'],
    sfxDefault: false,
    musicVolumeDefault: 0.14,
    aiPromptGuidance:
      'Prioritize visual calm and restraint. Use straight cuts, subtle slow motion on still images, and zero distracting sound effects.',
  },
  gaming: {
    id: 'gaming',
    name: 'Gaming Style',
    tagline: 'High-contrast punchy framing, electric highlights, and kinetic cues',
    targetSceneSeconds: [1.6, 3.2],
    pacingDescription: 'Action-synced cuts with punchy zooms and crisp highlights',
    colorGrade: {
      preset: 'vibrant',
      contrast: 1.15,
      brightness: 0.01,
      saturation: 1.22,
    },
    captionStyle: {
      stylePreset: 'neon_gaming',
      position: 'bottom_safe',
      fontSize: 60,
      primaryColor: '#FFFFFF',
      highlightColor: '#22D3EE',
      backgroundColor: '#050814',
      backgroundOpacity: 0.72,
      strokeColor: '#020617',
      strokeWidth: 6,
      shadowOpacity: 0.9,
      animation: 'pop',
    },
    preferredTransitions: ['cut', 'wipeleft', 'slideup'],
    preferredZooms: ['zoom_in_punch', 'pan_left_right', 'zoom_out_slow'],
    sfxDefault: true,
    musicVolumeDefault: 0.17,
    aiPromptGuidance:
      'Deliver energetic gaming-style pacing: punchy zooms on reactions or key callouts, crisp cuts, and vivid cyan/electric keyword highlights.',
  },
};

export const PRESET_LIST: EditingPresetDefinition[] = Object.values(EDITING_PRESETS);

export const CAPTION_STYLE_PRESETS: Record<
  CaptionStyleConfig['stylePreset'],
  {
    label: string;
    primaryColor: string;
    highlightColor: string;
    backgroundColor: string;
    backgroundOpacity: number;
    strokeColor: string;
    strokeWidth: number;
    fontSize: number;
  }
> = {
  hormozi_bold: {
    label: 'Bold Impact',
    primaryColor: '#FFFFFF',
    highlightColor: '#38BDF8',
    backgroundColor: '#060B16',
    backgroundOpacity: 0.62,
    strokeColor: '#000000',
    strokeWidth: 6,
    fontSize: 58,
  },
  clean_boxed: {
    label: 'Studio Boxed',
    primaryColor: '#FFFFFF',
    highlightColor: '#60A5FA',
    backgroundColor: '#0B1120',
    backgroundOpacity: 0.85,
    strokeColor: '#000000',
    strokeWidth: 2,
    fontSize: 50,
  },
  minimal_stroke: {
    label: 'Cinematic Crisp',
    primaryColor: '#F8FAFC',
    highlightColor: '#FBBF24',
    backgroundColor: '#000000',
    backgroundOpacity: 0.0,
    strokeColor: '#000000',
    strokeWidth: 5,
    fontSize: 48,
  },
  neon_gaming: {
    label: 'Electric Kinetic',
    primaryColor: '#FFFFFF',
    highlightColor: '#22D3EE',
    backgroundColor: '#050814',
    backgroundOpacity: 0.75,
    strokeColor: '#020617',
    strokeWidth: 6,
    fontSize: 60,
  },
  editorial_clean: {
    label: 'Editorial Minimal',
    primaryColor: '#F1F5F9',
    highlightColor: '#93C5FD',
    backgroundColor: '#0F172A',
    backgroundOpacity: 0.55,
    strokeColor: '#000000',
    strokeWidth: 3,
    fontSize: 46,
  },
};
