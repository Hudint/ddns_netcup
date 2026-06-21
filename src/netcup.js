const API_URL = 'https://ccp.netcup.net/run/webservice/servers/endpoint.php?JSON';

export class NetcupAPIError extends Error {}

export class NetcupClient {
  constructor(credentials, fetchImpl = fetch) {
    this.credentials = credentials;
    this.fetchImpl = fetchImpl;
  }

  authPayload(sessionId = null) {
    const payload = {
      customernumber: this.credentials.customerNumber,
      apikey: this.credentials.apiKey
    };
    if (sessionId) payload.apisessionid = sessionId;
    else payload.apipassword = this.credentials.apiPassword;
    return payload;
  }

  async request(payload) {
    const response = await this.fetchImpl(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'ddns-netcup-bridge/1.0' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30000)
    });

    if (!response.ok) {
      throw new NetcupAPIError(`HTTP ${response.status} from Netcup API`);
    }

    const data = await response.json();
    if (data.status !== 'success') {
      throw new NetcupAPIError(data.longmessage || 'Unknown Netcup API error');
    }
    return data;
  }

  async login() {
    const data = await this.request({ action: 'login', param: this.authPayload() });
    return data.responsedata.apisessionid;
  }

  async logout(sessionId) {
    await this.request({ action: 'logout', param: this.authPayload(sessionId) });
  }

  async infoDnsRecords(domain, sessionId) {
    const data = await this.request({
      action: 'infoDnsRecords',
      param: { ...this.authPayload(sessionId), domainname: domain }
    });
    if (!Array.isArray(data.responsedata?.dnsrecords)) {
      throw new NetcupAPIError('Invalid DNS records response');
    }
    return data.responsedata.dnsrecords;
  }

  async updateDnsRecords(domain, records, sessionId) {
    await this.request({
      action: 'updateDnsRecords',
      param: {
        ...this.authPayload(sessionId),
        domainname: domain,
        dnsrecordset: { dnsrecords: records }
      }
    });
  }
}

const applyRecord = (records, host, type, destination) => {
  let recordModified = false;
  let matched = false;

  for (const record of records) {
    if (record.hostname === host && record.type === type) {
      matched = true;
      if (record.destination !== destination) {
        record.destination = destination;
        recordModified = true;
      }
    }
  }

  if (!matched) {
    records.push({
      hostname: host,
      type,
      priority: '0',
      destination,
      deleterecord: 'false',
      state: 'yes'
    });
    recordModified = true;
  }

  return recordModified;
};

export class NetcupDNSService {
  constructor(client) {
    this.client = client;
  }

  async updateTargets(targets, ipv4, ipv6) {
    const byDomain = new Map();
    for (const target of targets) {
      if (!byDomain.has(target.domain)) byDomain.set(target.domain, []);
      byDomain.get(target.domain).push(target.host);
    }

    let anyChanged = false;
    const sessionId = await this.client.login();

    try {
      for (const [domain, hosts] of byDomain.entries()) {
        const records = await this.client.infoDnsRecords(domain, sessionId);
        let changed = false;

        for (const host of hosts) {
          if (ipv4) changed = changed || applyRecord(records, host, 'A', ipv4);
          if (ipv6) changed = changed || applyRecord(records, host, 'AAAA', ipv6);
        }

        if (changed) {
          await this.client.updateDnsRecords(domain, records, sessionId);
          anyChanged = true;
        }
      }
    } finally {
      await this.client.logout(sessionId);
    }

    return anyChanged;
  }
}
