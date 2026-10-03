import crypto from 'crypto';

interface RingEntry {
  hash: number;
  nodeName: string;
}

export class ConsistentHashRing {
  private ring: RingEntry[] = [];
  private vnodesPerNode: number;
  private nodes: Set<string> = new Set();

  constructor(vnodesPerNode: number = 50) {
    this.vnodesPerNode = vnodesPerNode;
  }

  // Hàm băm 32-bit từ chuỗi key
  private hashKey(key: string): number {
    const md5 = crypto.createHash('md5').update(key).digest();
    // Lấy 4 bytes đầu tiên làm số nguyên 32-bit không dấu (0 đến 2^32 - 1)
    return md5.readUInt32BE(0);
  }

  // Thêm một node vật lý vào vòng tròn (kèm các virtual nodes)
  addNode(nodeName: string): void {
    if (this.nodes.has(nodeName)) return;
    this.nodes.add(nodeName);

    for (let i = 0; i < this.vnodesPerNode; i++) {
      const vnodeKey = `${nodeName}#vnode_${i}`;
      const hash = this.hashKey(vnodeKey);
      this.ring.push({ hash, nodeName });
    }

    // Sắp xếp vòng tròn theo chiều kim đồng hồ (tăng dần giá trị hash)
    this.ring.sort((a, b) => a.hash - b.hash);
  }

  // Gỡ bỏ một node vật lý khỏi vòng tròn
  removeNode(nodeName: string): void {
    if (!this.nodes.has(nodeName)) return;
    this.nodes.delete(nodeName);
    this.ring = this.ring.filter(entry => entry.nodeName !== nodeName);
  }

  // Tìm node chịu trách nhiệm cho một key (Đi theo chiều kim đồng hồ)
  getNode(key: string): string {
    if (this.ring.length === 0) {
      throw new Error('Vòng tròn Consistent Hash đang rỗng!');
    }

    const keyHash = this.hashKey(key);

    // Thuật toán Binary Search tìm node đầu tiên có hash >= keyHash
    let low = 0;
    let high = this.ring.length - 1;
    let targetIndex = 0;

    if (keyHash > this.ring[high].hash) {
      // Vòng tròn khép kín: nếu vượt qua node cuối, quay về node đầu tiên
      targetIndex = 0;
    } else {
      while (low <= high) {
        const mid = Math.floor((low + high) / 2);
        if (this.ring[mid].hash >= keyHash) {
          targetIndex = mid;
          high = mid - 1; // Tìm tiếp bên trái xem có node nào gần hơn không
        } else {
          low = mid + 1;
        }
      }
    }

    return this.ring[targetIndex].nodeName;
  }

  getNodes(): string[] {
    return Array.from(this.nodes);
  }
}
