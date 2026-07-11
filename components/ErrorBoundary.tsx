"use client";

import React from "react";

interface State {
  error: Error | null;
}

export default class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  State
> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <main className="min-h-screen flex flex-col items-center justify-center gap-6 p-8">
          <h1 className="display text-3xl text-(--coral)">ENGINE FAILURE</h1>
          <p className="max-w-md text-center opacity-80 mono text-sm">
            Something crashed mid-race: {this.state.error.message}
          </p>
          <button
            onClick={() => window.location.reload()}
            className="btn-race px-6 py-3 text-lg uppercase cursor-pointer"
          >
            Restart engine
          </button>
        </main>
      );
    }
    return this.props.children;
  }
}
