"use client";

import { useState } from "react";
import type { PharmacyReview, ReviewSummary } from "@/lib/community";
import { Stars, Tag } from "@/components/ui";

const REVIEW_TAGS = [
  "Explained my medication",
  "Short wait",
  "Called my clinic",
  "Found me a lower price",
  "Bilingual staff",
  "Long wait",
  "Was out of stock",
];

export function ReviewSnapshot({ summary }: { summary?: ReviewSummary }) {
  if (!summary) return <p className="mt-1 text-xs text-black/40">No pharmacist reviews yet.</p>;
  return (
    <div className="mt-1 flex flex-wrap items-center gap-2">
      <Stars value={summary.average} />
      <span className="text-xs text-black/50">
        {summary.average.toFixed(1)} · {summary.count} pharmacist{" "}
        {summary.count === 1 ? "review" : "reviews"}
      </span>
      {summary.topTags.slice(0, 2).map((tag) => (
        <Tag key={tag}>{tag}</Tag>
      ))}
    </div>
  );
}

export function ReviewPanel({
  pharmacyId,
  pharmacyName,
  summary,
  onSubmitted,
}: {
  pharmacyId: string;
  pharmacyName: string;
  summary?: ReviewSummary;
  onSubmitted: () => Promise<void> | void;
}) {
  const [writing, setWriting] = useState(false);

  return (
    <div className="mt-3 border-t border-black/10 pt-3">
      {summary?.reviews.length ? (
        <ul className="space-y-3">
          {summary.reviews.slice(0, 4).map((review) => (
            <ReviewRow key={review.id} review={review} />
          ))}
        </ul>
      ) : (
        <p className="text-sm text-black/50">
          Nobody has reviewed this pharmacy team yet. Be the first.
        </p>
      )}

      {writing ? (
        <ReviewForm
          pharmacyId={pharmacyId}
          pharmacyName={pharmacyName}
          onDone={async () => {
            setWriting(false);
            await onSubmitted();
          }}
          onCancel={() => setWriting(false)}
        />
      ) : (
        <button
          className="mt-3 rounded-lg border border-black/15 px-3 py-1.5 text-sm"
          onClick={() => setWriting(true)}
        >
          Review this pharmacist
        </button>
      )}
    </div>
  );
}

function ReviewRow({ review }: { review: PharmacyReview }) {
  return (
    <li className="rounded-lg bg-mist/60 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Stars value={review.rating} />
        <span className="text-sm font-medium">{review.pharmacistName || "Pharmacy team"}</span>
        {review.demo && <Tag>sample data</Tag>}
      </div>
      <p className="mt-1 text-sm leading-6 text-black/70">{review.comment}</p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {review.tags.map((tag) => (
          <Tag key={tag}>{tag}</Tag>
        ))}
        <span className="text-xs text-black/40">{review.authorLabel}</span>
      </div>
    </li>
  );
}

function ReviewForm({
  pharmacyId,
  pharmacyName,
  onDone,
  onCancel,
}: {
  pharmacyId: string;
  pharmacyName: string;
  onDone: () => Promise<void>;
  onCancel: () => void;
}) {
  const [rating, setRating] = useState(5);
  const [pharmacistName, setPharmacistName] = useState("");
  const [comment, setComment] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggleTag(tag: string) {
    setTags((current) =>
      current.includes(tag) ? current.filter((item) => item !== tag) : [...current, tag],
    );
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/reviews", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pharmacyId, pharmacyName, pharmacistName, rating, tags, comment }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || "Could not save review");
      await onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save review");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-3 space-y-3 rounded-lg border border-black/10 p-3">
      <div className="flex items-center gap-2">
        <span className="text-sm text-black/60">Rating</span>
        {[1, 2, 3, 4, 5].map((value) => (
          <button
            key={value}
            type="button"
            aria-label={`${value} star${value === 1 ? "" : "s"}`}
            className={`text-xl leading-none ${value <= rating ? "text-clay" : "text-black/20"}`}
            onClick={() => setRating(value)}
          >
            ★
          </button>
        ))}
      </div>

      <input
        className="w-full rounded border border-black/15 px-2 py-1.5 text-sm"
        placeholder="Pharmacist name (optional)"
        value={pharmacistName}
        onChange={(event) => setPharmacistName(event.target.value)}
      />

      <div className="flex flex-wrap gap-2">
        {REVIEW_TAGS.map((tag) => (
          <button
            key={tag}
            type="button"
            className={`rounded-full px-2.5 py-1 text-xs ${
              tags.includes(tag) ? "bg-ink text-white" : "border border-black/15 text-black/60"
            }`}
            onClick={() => toggleTag(tag)}
          >
            {tag}
          </button>
        ))}
      </div>

      <textarea
        className="h-20 w-full rounded border border-black/15 p-2 text-sm"
        placeholder="What was the pharmacist like? Do not include your own name or date of birth."
        value={comment}
        onChange={(event) => setComment(event.target.value)}
      />

      {error && <p className="text-sm text-red-700">{error}</p>}

      <div className="flex gap-2">
        <button
          className="rounded-lg bg-clay px-3 py-1.5 text-sm text-white disabled:opacity-40"
          disabled={busy || !comment.trim()}
        >
          {busy ? "Posting…" : "Post review"}
        </button>
        <button type="button" className="text-sm text-black/50" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
