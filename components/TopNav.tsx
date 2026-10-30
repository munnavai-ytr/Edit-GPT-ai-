'use client';

import React from 'react';
import {
  Clapperboard,
  FolderKanban,
  KeyRound,
  PlaySquare,
  Plus,
  Sliders,
} from 'lucide-react';
import type {SettingsModalTab} from './SettingsModal';

export type WorkspaceTab = 'dashboard' | 'create' | 'workspace' | 'preview';

interface TopNavProps {
  activeTab: WorkspaceTab;
  onSelectTab: (tab: WorkspaceTab) => void;
  onNewProject: () => void;
  onOpenSettings: (tab?: SettingsModalTab) => void;
  hasActiveProject: boolean;
  hasRenderedVideo: boolean;
  hasActiveByokKey: boolean;
}

export default function TopNav({
  activeTab,
  onSelectTab,
  onNewProject,
  onOpenSettings,
  hasActiveProject,
  hasRenderedVideo,
  hasActiveByokKey,
}: TopNavProps) {
  return (
    <>
      {/* Desktop & Mobile Top Bar — Strict 3-Zone Contract */}
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-8 border-b border-slate-800/80 bg-[#060B16]/90 px-4 backdrop-blur-md sm:px-6 lg:px-8">
        {/* Zone 1: Single-line Brand Wordmark */}
        <button
          type="button"
          onClick={() => onSelectTab('dashboard')}
          className="text-left text-base font-bold tracking-tight text-white whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-blue-500"
        >
          AI Shorts Editor
        </button>

        {/* Zone 2: Clean Single-Line Text Navigation Links */}
        <nav
          aria-label="Primary Workspace Navigation"
          className="hidden md:flex items-center gap-7 text-sm font-medium text-slate-400"
        >
          <button
            type="button"
            onClick={() => onSelectTab('dashboard')}
            className={`py-1 transition-colors whitespace-nowrap shrink-0 hover:text-white ${
              activeTab === 'dashboard'
                ? 'text-white underline decoration-blue-500 decoration-2 underline-offset-8'
                : ''
            }`}
          >
            Dashboard
          </button>
          <button
            type="button"
            onClick={() => onSelectTab('create')}
            className={`py-1 transition-colors whitespace-nowrap shrink-0 hover:text-white ${
              activeTab === 'create'
                ? 'text-white underline decoration-blue-500 decoration-2 underline-offset-8'
                : ''
            }`}
          >
            Create Project
          </button>
          <button
            type="button"
            disabled={!hasActiveProject}
            onClick={() => onSelectTab('workspace')}
            className={`py-1 transition-colors whitespace-nowrap shrink-0 ${
              !hasActiveProject
                ? 'cursor-not-allowed text-slate-600'
                : activeTab === 'workspace'
                  ? 'text-white underline decoration-blue-500 decoration-2 underline-offset-8'
                  : 'hover:text-white'
            }`}
          >
            Editing Workspace
          </button>
          <button
            type="button"
            disabled={!hasRenderedVideo}
            onClick={() => onSelectTab('preview')}
            className={`py-1 transition-colors whitespace-nowrap shrink-0 ${
              !hasRenderedVideo
                ? 'cursor-not-allowed text-slate-600'
                : activeTab === 'preview'
                  ? 'text-white underline decoration-blue-500 decoration-2 underline-offset-8'
                  : 'hover:text-white'
            }`}
          >
            Final Preview
          </button>
          <button
            type="button"
            onClick={() => onOpenSettings('keys')}
            className="inline-flex items-center gap-1.5 py-1 transition-colors whitespace-nowrap shrink-0 hover:text-white"
          >
            {hasActiveByokKey && (
              <span
                aria-hidden="true"
                className="h-1.5 w-1.5 rounded-full bg-emerald-400"
              />
            )}
            <span>API Keys &amp; Settings</span>
          </button>
        </nav>

        {/* Zone 3: 1 Primary Action */}
        <div className="flex items-center shrink-0">
          <button
            type="button"
            onClick={onNewProject}
            className="inline-flex min-h-[40px] items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-blue-500 focus-visible:outline-2 focus-visible:outline-blue-400 whitespace-nowrap shrink-0"
          >
            <Plus className="h-4 w-4" />
            <span>New Project</span>
          </button>
        </div>
      </header>

      {/* Mobile Bottom Thumb-Zone Navigation (Hidden on Desktop, <=15% total sticky budget) */}
      <nav
        aria-label="Mobile Navigation"
        className="fixed bottom-0 left-0 right-0 z-30 grid h-14 grid-cols-5 items-center border-t border-slate-800/90 bg-[#060B16]/95 px-1 backdrop-blur-md md:hidden"
      >
        <button
          type="button"
          onClick={() => onSelectTab('dashboard')}
          className={`flex min-h-[44px] flex-col items-center justify-center ${
            activeTab === 'dashboard' ? 'text-blue-400' : 'text-slate-400'
          }`}
        >
          <FolderKanban className="h-4 w-4" />
          <span className="mt-0.5 text-[10px] font-medium whitespace-nowrap">
            Projects
          </span>
        </button>

        <button
          type="button"
          onClick={() => onSelectTab('create')}
          className={`flex min-h-[44px] flex-col items-center justify-center ${
            activeTab === 'create' ? 'text-blue-400' : 'text-slate-400'
          }`}
        >
          <Clapperboard className="h-4 w-4" />
          <span className="mt-0.5 text-[10px] font-medium whitespace-nowrap">
            Upload
          </span>
        </button>

        <button
          type="button"
          disabled={!hasActiveProject}
          onClick={() => onSelectTab('workspace')}
          className={`flex min-h-[44px] flex-col items-center justify-center ${
            !hasActiveProject
              ? 'text-slate-700'
              : activeTab === 'workspace'
                ? 'text-blue-400'
                : 'text-slate-400'
          }`}
        >
          <Sliders className="h-4 w-4" />
          <span className="mt-0.5 text-[10px] font-medium whitespace-nowrap">
            Pipeline
          </span>
        </button>

        <button
          type="button"
          disabled={!hasRenderedVideo}
          onClick={() => onSelectTab('preview')}
          className={`flex min-h-[44px] flex-col items-center justify-center ${
            !hasRenderedVideo
              ? 'text-slate-700'
              : activeTab === 'preview'
                ? 'text-blue-400'
                : 'text-slate-400'
          }`}
        >
          <PlaySquare className="h-4 w-4" />
          <span className="mt-0.5 text-[10px] font-medium whitespace-nowrap">
            Preview
          </span>
        </button>

        <button
          type="button"
          onClick={() => onOpenSettings('keys')}
          className="flex min-h-[44px] flex-col items-center justify-center text-slate-400"
        >
          <KeyRound
            className={`h-4 w-4 ${hasActiveByokKey ? 'text-emerald-400' : ''}`}
          />
          <span className="mt-0.5 text-[10px] font-medium whitespace-nowrap">
            API Keys
          </span>
        </button>
      </nav>
    </>
  );
}
