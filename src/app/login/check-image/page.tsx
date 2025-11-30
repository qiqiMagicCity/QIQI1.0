"use client";
import React from "react";
import Image from "next/image";

export default function CheckImagePage() {
    return (
        <div className="min-h-screen bg-black flex items-center justify-center">
            <Image src="/temp_check.png" alt="Check" width={800} height={800} className="object-contain" />
        </div>
    );
}
