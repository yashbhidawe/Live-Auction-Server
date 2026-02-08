import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RtcRole, RtcTokenBuilder } from 'agora-access-token';

const TOKEN_EXPIRY_SECONDS = 3600; // 1 hour

@Injectable()
export class AgoraService {
  constructor(private readonly config: ConfigService) {}

  generateToken(
    channel: string,
    uid: number,
    role: 'seller' | 'buyer',
  ): string {
    const appId = this.config.get<string>('agora.appId');
    const appCert = this.config.get<string>('agora.appCertificate');

    if (!appId || !appCert) {
      throw new Error('Agora APP ID and Certificate must be set');
    }

    const rtcRole = role === 'seller' ? RtcRole.PUBLISHER : RtcRole.SUBSCRIBER;
    const privilegeExpiredTs =
      Math.floor(Date.now() / 1000) + TOKEN_EXPIRY_SECONDS;

    return RtcTokenBuilder.buildTokenWithUid(
      appId,
      appCert,
      channel,
      uid,
      rtcRole,
      privilegeExpiredTs,
    );
  }
}
