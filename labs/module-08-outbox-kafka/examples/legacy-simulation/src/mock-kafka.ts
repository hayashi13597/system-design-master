export interface KafkaRecord {
  topic: string;
  key: string;
  value: any;
  offset: number;
  timestamp: number;
}

/**
 * Giả lập Apache Kafka Message Broker
 * Hỗ trợ mô phỏng mất mạng, broker sập (offline) và ghi nhận Offset
 */
export class MockKafkaBroker {
  private isOnline: boolean = true;
  private topics: Map<string, KafkaRecord[]> = new Map();
  private globalOffset: number = 0;

  /**
   * Bật / tắt trạng thái Broker để mô phỏng Network Partition hoặc Service Crash
   */
  setOnline(status: boolean) {
    this.isOnline = status;
    console.log(`[KafkaBroker] Trạng thái Broker chuyển sang: ${status ? '🟢 ONLINE' : '🔴 OFFLINE (SẬP MẠNG)'}`);
  }

  getOnlineStatus(): boolean {
    return this.isOnline;
  }

  /**
   * Publish một message vào Topic
   */
  async produce(topic: string, key: string, value: any): Promise<KafkaRecord> {
    if (!this.isOnline) {
      // Mô phỏng ConnectionRefused hoặc Timeout khi Kafka sập
      throw new Error(`[KafkaProduceError] Không thể kết nối tới Kafka Broker (Broker OFFLINE hoặc Partition Mất Mạng)!`);
    }

    if (!this.topics.has(topic)) {
      this.topics.set(topic, []);
    }

    const record: KafkaRecord = {
      topic,
      key,
      value,
      offset: this.globalOffset++,
      timestamp: Date.now()
    };

    this.topics.get(topic)!.push(record);
    return record;
  }

  getTopicRecords(topic: string): KafkaRecord[] {
    return this.topics.get(topic) || [];
  }

  getAllRecords(): KafkaRecord[] {
    const all: KafkaRecord[] = [];
    for (const records of this.topics.values()) {
      all.push(...records);
    }
    return all;
  }

  reset() {
    this.topics.clear();
    this.globalOffset = 0;
    this.isOnline = true;
  }
}

export const kafka = new MockKafkaBroker();
