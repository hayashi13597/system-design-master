/**
 * Twitter Snowflake ID Generator (64-bit BigInt)
 * 
 * Cấu trúc 64-bit:
 * 1 bit: Unused (dương)
 * 41 bits: Timestamp (mili-giây tính từ CUSTOM_EPOCH) -> Dùng được ~69 năm
 * 5 bits: Datacenter ID (0 - 31)
 * 5 bits: Worker ID (0 - 31)
 * 12 bits: Sequence Number (0 - 4095) trên mỗi mili-giây
 */
export class SnowflakeGenerator {
  // Mốc thời gian bắt đầu hệ thống: 01/01/2026 00:00:00 UTC
  private readonly CUSTOM_EPOCH = 1767225600000n;

  private readonly WORKER_ID_BITS = 5n;
  private readonly DATACENTER_ID_BITS = 5n;
  private readonly SEQUENCE_BITS = 12n;

  private readonly MAX_WORKER_ID = -1n ^ (-1n << this.WORKER_ID_BITS); // 31
  private readonly MAX_DATACENTER_ID = -1n ^ (-1n << this.DATACENTER_ID_BITS); // 31
  private readonly MAX_SEQUENCE = -1n ^ (-1n << this.SEQUENCE_BITS); // 4095

  private readonly WORKER_ID_SHIFT = this.SEQUENCE_BITS; // 12
  private readonly DATACENTER_ID_SHIFT = this.SEQUENCE_BITS + this.WORKER_ID_BITS; // 17
  private readonly TIMESTAMP_LEFT_SHIFT = this.SEQUENCE_BITS + this.WORKER_ID_BITS + this.DATACENTER_ID_BITS; // 22

  private workerId: bigint;
  private datacenterId: bigint;
  private sequence: bigint = 0n;
  private lastTimestamp: bigint = -1n;

  constructor(workerId: number = 1, datacenterId: number = 1) {
    if (workerId < 0 || BigInt(workerId) > this.MAX_WORKER_ID) {
      throw new Error(`Worker ID phải từ 0 đến ${this.MAX_WORKER_ID}`);
    }
    if (datacenterId < 0 || BigInt(datacenterId) > this.MAX_DATACENTER_ID) {
      throw new Error(`Datacenter ID phải từ 0 đến ${this.MAX_DATACENTER_ID}`);
    }

    this.workerId = BigInt(workerId);
    this.datacenterId = BigInt(datacenterId);
  }

  // Sinh ID 64-bit duy nhất
  nextId(): string {
    let timestamp = BigInt(Date.now());

    // Chống hiện tượng Clock Drift (đồng hồ hệ thống bị nhảy lùi)
    if (timestamp < this.lastTimestamp) {
      throw new Error(`Lỗi Clock Drift! Đồng hồ hệ thống đã lùi lại ${this.lastTimestamp - timestamp}ms.`);
    }

    // Nếu cùng trong 1 mili-giây
    if (timestamp === this.lastTimestamp) {
      this.sequence = (this.sequence + 1n) & this.MAX_SEQUENCE;
      // Nếu đã vượt quá 4096 IDs trong cùng 1ms -> Đợi sang mili-giây tiếp theo
      if (this.sequence === 0n) {
        while (timestamp <= this.lastTimestamp) {
          timestamp = BigInt(Date.now());
        }
      }
    } else {
      this.sequence = 0n;
    }

    this.lastTimestamp = timestamp;

    // Phép dịch bit (Bitwise Shift) để ghép thành số nguyên 64-bit
    const id = ((timestamp - this.CUSTOM_EPOCH) << this.TIMESTAMP_LEFT_SHIFT)
      | (this.datacenterId << this.DATACENTER_ID_SHIFT)
      | (this.workerId << this.WORKER_ID_SHIFT)
      | this.sequence;

    return id.toString();
  }

  // Giải mã Snowflake ID để thấy các thành phần bên trong
  parseId(idStr: string) {
    const id = BigInt(idStr);
    const sequence = Number(id & this.MAX_SEQUENCE);
    const workerId = Number((id >> this.WORKER_ID_SHIFT) & this.MAX_WORKER_ID);
    const datacenterId = Number((id >> this.DATACENTER_ID_SHIFT) & this.MAX_DATACENTER_ID);
    const timestampOffset = id >> this.TIMESTAMP_LEFT_SHIFT;
    const timestamp = Number(timestampOffset + this.CUSTOM_EPOCH);

    return {
      id: idStr,
      timestamp,
      createdAt: new Date(timestamp).toISOString(),
      datacenterId,
      workerId,
      sequence
    };
  }
}

export const snowflake = new SnowflakeGenerator(1, 1);
