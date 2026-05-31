# Flutter Integration Guide: Report API Authentication

> ⚠️ **Phase 2 — planned contract, not in the MVP.** `POST /api/reports` and its
> HMAC policy are **not exposed in the current backend** (read-only ČHMÚ MVP).
> This document is the client contract to implement when submission ships; the
> server side must add rate limiting + `client_report_id` idempotence first
> (see [API Security](./api-security.md) → Phase 2).

This document explains how to authenticate requests to the `POST /api/reports` endpoint from a Flutter mobile application.

## Overview

The Report API uses a multi-layered approach:

1. **HMAC-SHA256 Signature** – best-effort proof the request comes from the app
2. **Timestamp Validation** – replay deterrent (5-minute window)
3. **Geo-Fence Validation** – the user must be physically near the spring (≤200m)

> The HMAC/timestamp layer is **best-effort anti-bot**, not a trust anchor — the
> shared secret ships in the app. Sign at **queue flush** (so offline reports
> aren't rejected by the 5-minute window), and rely on the geofence + (later)
> trust scoring for real trust. See [API Security](./api-security.md).

---

## Required Headers

| Header | Format | Description |
|--------|--------|-------------|
| `X-Timestamp` | Unix timestamp (seconds) | Current time when request is created |
| `X-App-Signature` | Hex string (64 chars) | HMAC-SHA256 signature |

---

## Signature Construction

The signature must be constructed **exactly** as shown below. Any deviation will result in a `403 Forbidden` response.

### Payload Format

```
{timestamp}:{springDocumentId}
```

**Example payload:**
```
1736622000:abc123xyz456
```

### Algorithm

1. Get current Unix timestamp in **seconds** (not milliseconds)
2. Concatenate: `"{timestamp}:{springDocumentId}"`
3. Compute HMAC-SHA256 using the shared secret
4. Encode result as lowercase hexadecimal string

---

## Dart Implementation

```dart
import 'dart:convert';
import 'package:crypto/crypto.dart';  // Add: crypto: ^3.0.0

class ReportAuthService {
  // This secret must match HMAC_SECRET in Strapi's .env
  // In production: load from secure storage or build-time env
  static const String _hmacSecret = 'your-shared-secret-min-32-chars';

  /// Generates authentication headers for a report request.
  static Map<String, String> generateAuthHeaders(String springDocumentId) {
    // Step 1: Get current timestamp in seconds
    final timestamp = (DateTime.now().millisecondsSinceEpoch ~/ 1000).toString();

    // Step 2: Create payload
    final payload = '$timestamp:$springDocumentId';

    // Step 3: Generate HMAC-SHA256 signature
    final hmac = Hmac(sha256, utf8.encode(_hmacSecret));
    final digest = hmac.convert(utf8.encode(payload));
    final signature = digest.toString();  // Lowercase hex

    return {
      'X-Timestamp': timestamp,
      'X-App-Signature': signature,
    };
  }
}
```

---

## Complete Request Example

```dart
import 'package:http/http.dart' as http;
import 'dart:convert';

Future<void> submitReport({
  required String springDocumentId,
  required double userLat,
  required double userLng,
  required bool isFlowing,
  required String clientReportId, // stable per queued report → idempotent retries
  int? flowScale,                 // 1–5, optional
  double? flowRateLps,            // measured discharge, optional
  bool? hasOdor,                  // optional (nullable)
  String? waterClarity,           // optional (nullable)
  String? note,
}) async {
  final uri = Uri.parse('https://your-strapi-url.com/api/reports');

  // Generate auth headers
  final authHeaders = ReportAuthService.generateAuthHeaders(springDocumentId);

  final response = await http.post(
    uri,
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders,  // X-Timestamp and X-App-Signature
    },
    body: jsonEncode({
      'data': {
        'spring': springDocumentId,
        'user_lat': userLat,
        'user_lng': userLng,
        'is_flowing': isFlowing,
        'client_report_id': clientReportId,
        'reported_at': DateTime.now().toUtc().toIso8601String(),
        if (flowScale != null) 'flow_scale': flowScale,
        if (flowRateLps != null) 'flow_rate_lps': flowRateLps,
        if (hasOdor != null) 'has_odor': hasOdor,
        if (waterClarity != null) 'water_clarity': waterClarity,
        if (note != null) 'note': note,
      },
    }),
  );

  if (response.statusCode == 200 || response.statusCode == 201) {
    print('Report submitted successfully');
  } else {
    print('Failed: ${response.statusCode} - ${response.body}');
  }
}
```

---

## Error Responses

| Status | Meaning | Likely Cause |
|--------|---------|--------------|
| `403` | Forbidden | Invalid signature, expired timestamp, or geo-fence violation |
| `400` | Bad Request | Missing required fields in request body |
| `404` | Not Found | Invalid `springDocumentId` |

### Troubleshooting 403 Errors

1. **Signature mismatch**: Verify payload format is exactly `{timestamp}:{springDocumentId}`
2. **Timestamp expired**: Ensure device clock is synchronized (NTP)
3. **Geo-fence**: User must be within 200 meters of the spring's coordinates

---

## Security Notes

> [!WARNING]
> **Secret Protection**: Never hardcode `HMAC_SECRET` in source control. Use:
> - Dart defines (`--dart-define`)
> - Secure storage (e.g., `flutter_secure_storage`)
> - Environment-specific build configurations

> [!TIP]
> **Clock Sync**: The 5-minute window is generous, but devices with incorrect time will fail. Consider detecting and warning users about clock drift.

---

## Dependencies

Add to `pubspec.yaml`:

```yaml
dependencies:
  crypto: ^3.0.0
  http: ^1.0.0
```
