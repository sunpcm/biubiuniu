"use client";

import React, { useEffect, useState } from "react";
import { SiDiscord } from "react-icons/si";

const DiscordInviteWidget: React.FC = () => {
  const [isVisible, setIsVisible] = useState(true);
  const [isHovered, setIsHovered] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      setIsVisible(false);
    }, 5000);

    return () => clearTimeout(timer);
  }, []);

  return (
    <>
      {process.env.NEXT_PUBLIC_DISCORD_INVITE_URL && (
        <a
          href={process.env.NEXT_PUBLIC_DISCORD_INVITE_URL}
          target="_blank"
          rel="noopener noreferrer"
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => setIsHovered(false)}
          className={`group fixed bottom-20 z-1000 flex h-14 w-14 transform cursor-pointer items-center justify-center rounded-full border-none bg-[#5865F2] text-white no-underline shadow-lg shadow-[#5865F2]/30 transition-all duration-300 ease-out hover:scale-110 hover:bg-[#4752C4] hover:shadow-xl hover:shadow-[#5865F2]/40 active:scale-95 ${isVisible || isHovered ? "right-0" : "-right-6"} `}
          aria-label="Join Discord Server"
        >
          <SiDiscord
            className="h-8 w-8 text-white transition-transform duration-300"
            style={{
              transform: isVisible || isHovered ? "rotate(360deg)" : "rotate(270deg)",
            }}
          />
        </a>
      )}
    </>
  );
};

export default DiscordInviteWidget;
