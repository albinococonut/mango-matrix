import { NextRequest, NextResponse } from 'next/server';
import { requireExecutive } from '@/lib/serverAuth';
import { getRCToken } from '@/lib/ringcentral';
import { readCache } from '@/lib/cache';
import { SHOPS } from '@/lib/shops';
import { searchCustomersByPhone } from '@/lib/tekmetric';

export const dynamic = 'force-dynamic';

export const GET = requireExecutive(async (_req: NextRequest) => {

  const results: Record<string, unknown> = {};

  // 1. Check credentials present
  results.credsPresent = {
    clientId: !!process.env.RINGCENTRAL_CLIENT_ID,
    clientSecret: !!process.env.RINGCENTRAL_CLIENT_SECRET,
    jwt: !!process.env.RINGCENTRAL_JWT,
    server: process.env.RINGCENTRAL_SERVER ?? '(default platform.ringcentral.com)',
    openaiKey: !!process.env.OPENAI_API_KEY,
  };

  // 2. Try to get a token
  try {
    const token = await getRCToken();
    results.auth = { ok: true, tokenPrefix: token.slice(0, 12) + '…' };
  } catch (e: any) {
    results.auth = { ok: false, error: e?.message };
  }

  // 3. Check phone map cache
  const cached = await readCache<Record<string, string>>('rc_phone_shop_map');
  results.phoneMap = cached
    ? { cached: true, count: Object.keys(cached).length, all: Object.entries(cached).sort((a, b) => a[1].localeCompare(b[1])) }
    : { cached: false };

  const RC_BASE = process.env.RINGCENTRAL_SERVER ?? 'https://platform.ringcentral.com';

  // 3b. Fetch raw phone-number list to find unmatched numbers
  if ((results.auth as any)?.ok) {
    try {
      const token = await getRCToken();
      const RC_BASE = process.env.RINGCENTRAL_SERVER ?? 'https://platform.ringcentral.com';
      const resp = await fetch(`${RC_BASE}/restapi/v1.0/account/~/phone-number?perPage=1000`, {
        headers: { Authorization: `Bearer ${token}` }, cache: 'no-store',
      });
      if (resp.ok) {
        const data = await resp.json();
        const unmatched: any[] = [];
        const matchedNums = new Set((results.phoneMap as any)?.all?.map((e: any[]) => e[0]) ?? []);
        for (const rec of data.records ?? []) {
          const digits = (rec.phoneNumber ?? '').replace(/\D/g, '');
          const ten = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
          if (ten.length >= 7 && !matchedNums.has(ten)) {
            unmatched.push({ phone: ten, site: rec.site?.name, ext: rec.extension?.extensionNumber, extName: rec.extension?.name });
          }
        }
        results.unmatchedPhones = { count: unmatched.length, phones: unmatched.slice(0, 20) };
      }
    } catch (e: any) {
      results.unmatchedPhones = { error: e?.message };
    }
  }

  // 4. Inbound call log sample
  if ((results.auth as any)?.ok) {
    try {
      const token = await getRCToken();
      const today = new Date().toISOString().slice(0, 10);
      const resp = await fetch(
        `${RC_BASE}/restapi/v1.0/account/~/call-log?direction=Inbound&type=Voice&view=Detailed&perPage=5&dateFrom=${today}T00:00:00.000Z`,
        { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' }
      );
      if (resp.ok) {
        const data = await resp.json();
        results.callLog = {
          ok: true,
          totalCount: data.paging?.totalElements ?? '?',
          recordsInPage: (data.records ?? []).length,
          firstRecord: data.records?.[0]
            ? {
                id: data.records[0].id,
                startTime: data.records[0].startTime,
                duration: data.records[0].duration,
                to: data.records[0].to?.phoneNumber,
                hasTranscript: !!(data.records[0].recording?.transcript),
                transcriptLength: data.records[0].recording?.transcript?.length ?? 0,
              }
            : null,
        };
      } else {
        results.callLog = { ok: false, status: resp.status, body: (await resp.text()).slice(0, 200) };
      }
    } catch (e: any) {
      results.callLog = { ok: false, error: e?.message };
    }
  }

  // 5. Outbound call log — last 7 days, first 10 records with recording/extension info
  if ((results.auth as any)?.ok) {
    try {
      const token = await getRCToken();
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const today = new Date().toISOString().slice(0, 10);
      const resp = await fetch(
        `${RC_BASE}/restapi/v1.0/account/~/call-log?direction=Outbound&type=Voice&view=Detailed&perPage=10`
        + `&dateFrom=${sevenDaysAgo}T00:00:00.000Z&dateTo=${today}T23:59:59.999Z`,
        { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' }
      );
      if (resp.ok) {
        const data = await resp.json();
        results.outboundLog = {
          ok: true,
          totalCount: data.paging?.totalElements ?? '?',
          records: (data.records ?? []).slice(0, 10).map((r: any) => ({
            id: r.id,
            startTime: r.startTime,
            duration: r.duration,
            fromExt: r.from?.extensionNumber ?? null,
            fromPhone: r.from?.phoneNumber ?? null,
            toPhone: r.to?.phoneNumber ?? null,
            hasRecording: !!(r.recording?.contentUri),
            recordingId: r.recording?.id ?? null,
            contentUri: r.recording?.contentUri ?? null,
          })),
        };
      } else {
        results.outboundLog = { ok: false, status: resp.status, body: (await resp.text()).slice(0, 200) };
      }
    } catch (e: any) {
      results.outboundLog = { ok: false, error: e?.message };
    }
  }

  // 6. RC extension details for the unmatched extension IDs
  if ((results.auth as any)?.ok) {
    try {
      const token = await getRCToken();
      const unmatchedExts = [...new Set(
        ((results.unmatchedPhones as any)?.phones ?? [])
          .map((p: any) => p.ext)
          .filter(Boolean)
      )];
      const extDetails: Record<string, any> = {};
      for (const extNum of unmatchedExts) {
        const resp = await fetch(
          `${RC_BASE}/restapi/v1.0/account/~/extension?extensionNumber=${extNum}&perPage=10`,
          { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' }
        );
        if (resp.ok) {
          const data = await resp.json();
          extDetails[extNum as string] = (data.records ?? []).map((r: any) => ({
            id: r.id,
            extNum: r.extensionNumber,
            name: r.name,
            type: r.type,
            site: r.site?.name,
            contact: r.contact?.department,
          }));
        } else {
          extDetails[extNum as string] = { error: resp.status };
        }
      }
      results.extDetails = extDetails;
    } catch (e: any) {
      results.extDetails = { error: e?.message };
    }
  }

  // 6b. Try downloading one recording to verify audio download scope.
  // Uses a hardcoded recent recording ID (2984647952010) as a fallback when
  // the outbound call log is rate-limited, so this test can run independently.
  if ((results.auth as any)?.ok) {
    try {
      const token = await getRCToken();
      const fallbackRecordingId = '2984647952010';
      const firstRecWithRecording = ((results.outboundLog as any)?.records ?? [])
        .find((r: any) => r.hasRecording && r.recordingId);
      const recordingId = firstRecWithRecording?.recordingId ?? fallbackRecordingId;
      const contentUri = `${RC_BASE}/restapi/v1.0/account/~/recording/${recordingId}/content`;
      const audioResp = await fetch(contentUri, {
        headers: { Authorization: `Bearer ${token}` }, cache: 'no-store',
        redirect: 'follow',
      });
      const finalUrl = audioResp.url;
      const bodySnippet = audioResp.ok
        ? `(binary ok — ${audioResp.headers.get('content-type')}, ${audioResp.headers.get('content-length')} bytes)`
        : (await audioResp.text()).slice(0, 400);
      results.audioDownloadTest = {
        recordingId,
        usingFallback: !firstRecWithRecording,
        status: audioResp.status,
        ok: audioResp.ok,
        finalUrl: finalUrl !== contentUri ? finalUrl.slice(0, 80) + '…' : '(no redirect)',
        contentType: audioResp.headers.get('content-type'),
        body: bodySnippet,
      };
    } catch (e: any) {
      results.audioDownloadTest = { error: e?.message };
    }
  }

  // 6c. Try a live Whisper transcription on the first short recording we can find
  if ((results.auth as any)?.ok && process.env.OPENAI_API_KEY) {
    try {
      const token = await getRCToken();
      // Use the shortest recording with a contentUri to minimise Whisper latency
      const recs = ((results.outboundLog as any)?.records ?? [])
        .filter((r: any) => r.hasRecording && r.contentUri && r.duration >= 30)
        .sort((a: any, b: any) => a.duration - b.duration);
      const testRec = recs[0];
      if (testRec) {
        const audioResp = await fetch(testRec.contentUri, {
          headers: { Authorization: `Bearer ${token}` }, cache: 'no-store',
        });
        if (audioResp.ok) {
          const audioBuffer = await audioResp.arrayBuffer();
          const form = new FormData();
          form.append('file', new Blob([audioBuffer], { type: 'audio/mpeg' }), 'recording.mp3');
          form.append('model', 'whisper-1');
          const whisperResp = await fetch('https://api.openai.com/v1/audio/transcriptions', {
            method: 'POST',
            headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
            body: form, cache: 'no-store',
          });
          if (whisperResp.ok) {
            const data = await whisperResp.json();
            results.whisperTest = {
              ok: true,
              recordingId: testRec.recordingId,
              duration: testRec.duration,
              audioBytes: audioBuffer.byteLength,
              transcriptLength: (data.text ?? '').length,
              transcriptSnippet: (data.text ?? '').slice(0, 120),
            };
          } else {
            const errText = await whisperResp.text();
            results.whisperTest = { ok: false, status: whisperResp.status, error: errText.slice(0, 300) };
          }
        } else {
          results.whisperTest = { ok: false, audioStatus: audioResp.status };
        }
      } else {
        results.whisperTest = { skipped: 'no eligible recordings in outbound log' };
      }
    } catch (e: any) {
      results.whisperTest = { error: e?.message };
    }
  }

  // 7. Tekmetric customer lookup for recent outbound call recipients from 5056331001
  if ((results.auth as any)?.ok) {
    try {
      const targetPhone = '5056331001';
      const recentToPhones = ((results.outboundLog as any)?.records ?? [])
        .filter((r: any) => (r.fromPhone ?? '').replace(/\D/g, '').endsWith(targetPhone))
        .map((r: any) => (r.toPhone ?? '').replace(/\D/g, '').slice(-10))
        .filter(Boolean)
        .slice(0, 5) as string[];

      const lookups: Array<{ phone: string; shopNum: string; shopName: string; customerId: number | null }> = [];
      for (const phone of recentToPhones) {
        for (const shop of SHOPS) {
          const customerId = await searchCustomersByPhone(shop.tekmetricId, phone);
          if (customerId !== null) {
            lookups.push({ phone, shopNum: shop.num, shopName: shop.name, customerId });
            break;
          }
        }
        if (!lookups.find(l => l.phone === phone)) {
          lookups.push({ phone, shopNum: '?', shopName: 'not found', customerId: null });
        }
      }
      results.outboundCallCustomers = { targetFrom: targetPhone, lookups };
    } catch (e: any) {
      results.outboundCallCustomers = { error: e?.message };
    }
  }

  return NextResponse.json(results, { status: 200 });
});
