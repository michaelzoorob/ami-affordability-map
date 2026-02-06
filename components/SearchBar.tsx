"use client";

import { useState, useEffect, FormEvent } from "react";

interface SearchBarProps {
  onSearch: (address: string) => void;
  isLoading: boolean;
  initialAddress?: string;
}

export default function SearchBar({ onSearch, isLoading, initialAddress }: SearchBarProps) {
  const [address, setAddress] = useState("");

  useEffect(() => {
    if (initialAddress) setAddress(initialAddress);
  }, [initialAddress]);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (address.trim()) {
      onSearch(address.trim());
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex gap-2">
      <input
        type="text"
        value={address}
        onChange={(e) => setAddress(e.target.value)}
        placeholder="Enter an address (e.g., 1600 Pennsylvania Ave NW, Washington, DC 20500)"
        className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
        disabled={isLoading}
      />
      <button
        type="submit"
        disabled={isLoading || !address.trim()}
        className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium whitespace-nowrap"
      >
        {isLoading ? "Looking up..." : "Search"}
      </button>
    </form>
  );
}
