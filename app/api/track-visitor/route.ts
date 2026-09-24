import { withApiUsage } from "@/lib/telemetry/usage"
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { clientIpFromHeaders } from "@/lib/http/clientIp";

function getClientIp(request: NextRequest): string | null {
  return clientIpFromHeaders(request.headers);
}

async function geolocateIp(ip: string) {
  try {
    if (ip === "127.0.0.1" || ip.startsWith("192.168.") || ip.startsWith("10.") || ip === "::1") {
      return null;
    }
    const res = await fetch(`http://ip-api.com/json/${ip}?fields=status,country,countryCode,regionName,city,lat,lon`, {
      next: { revalidate: 86400 },
    });
    const data = await res.json();
    if (data.status === "success") {
      return {
        city: data.city,
        region: data.regionName,
        country: data.country,
        countryCode: data.countryCode,
        lat: data.lat,
        lng: data.lon,
      };
    }
  } catch (e) {
    console.error("Geolocation error:", e);
  }
  return null;
}

export const POST = withApiUsage({ endpoint: "/api/track-visitor", tool: "TrackVisitor" })(async (request: NextRequest) => {
  try {
    const ip = getClientIp(request);
    if (!ip) {
      return NextResponse.json({ ok: true, tracked: false });
    }

    const existing = await prisma.visitorLocation.findUnique({
      where: { ipAddress: ip },
    });

    if (existing) {
      await prisma.visitorLocation.update({
        where: { ipAddress: ip },
        data: {
          visits: { increment: 1 },
          lastSeen: new Date(),
        },
      });
      return NextResponse.json({ ok: true, tracked: true, returning: true });
    }

    const geo = await geolocateIp(ip);
    if (!geo) {
      return NextResponse.json({ ok: true, tracked: false });
    }

    await prisma.visitorLocation.create({
      data: {
        ipAddress: ip,
        ...geo,
      },
    });

    return NextResponse.json({ ok: true, tracked: true, new: true });
  } catch (e) {
    console.error("Track visitor error:", e);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
})
