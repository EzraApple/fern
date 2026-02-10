"use client";

import { ArchiveBrowser } from "@/components/memory/ArchiveBrowser";
import { MemoryList } from "@/components/memory/MemoryList";
import { SearchInterface } from "@/components/memory/SearchInterface";
import { clsx } from "clsx";
import { useState } from "react";

const tabs = ["Memories", "Archives", "Search"] as const;
type Tab = (typeof tabs)[number];

export default function MemoryPage() {
  const [activeTab, setActiveTab] = useState<Tab>("Memories");

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6" style={{ color: "var(--text-primary)" }}>
        Memory
      </h1>

      {/* Tabs */}
      <div
        className="flex gap-1 mb-6 p-1 rounded-lg w-fit"
        style={{ backgroundColor: "var(--bg-secondary)" }}
      >
        {tabs.map((tab) => (
          <button
            type="button"
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={clsx("px-4 py-1.5 rounded-md text-sm transition-colors")}
            style={{
              backgroundColor: activeTab === tab ? "var(--bg-hover)" : "transparent",
              color: activeTab === tab ? "var(--text-primary)" : "var(--text-secondary)",
            }}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === "Memories" && <MemoryList />}
      {activeTab === "Archives" && <ArchiveBrowser />}
      {activeTab === "Search" && <SearchInterface />}
    </div>
  );
}
