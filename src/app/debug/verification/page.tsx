"use client";

import { MetricVerificationReport } from "@/components/dashboard/metric-verification-report";

export default function VerificationPage() {
    return (
        <div className="p-8">
            <h1 className="text-2xl font-bold mb-4">Metric Verification Debug Page</h1>
            <MetricVerificationReport />
        </div>
    );
}
