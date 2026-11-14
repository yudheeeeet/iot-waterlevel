import { readingsTopic, statusTopic, type BrokerProvisioner, type BrokerSetup } from './provisioner.js';

/**
 * `manual` adapter (HiveMQ Cloud): the backend cannot manage broker accounts, so nothing is called;
 * each operation returns the steps the admin performs in the HiveMQ Cloud console.
 * The device stays `broker_sync_status = 'pending'` until the admin marks it done (PATCH brokerSynced).
 */
const CONSOLE = 'Buka console.hivemq.cloud → pilih cluster → tab "Access Management"';

function setup(id: string, action: BrokerSetup['action']): BrokerSetup {
  const topics = [readingsTopic(id), statusTopic(id)];
  const credential = { username: id, topics, permission: 'publish' as const };
  const permissionSteps = [
    `Permission: bila tersedia pilihan role/topic khusus, izinkan hanya PUBLISH ke ${topics.join(' dan ')}. ` +
      'Bila paket hanya menyediakan pilihan umum, pilih "Publish Only".',
  ];
  const done = 'Setelah selesai, tandai device ini "Sudah disetel di broker" di dashboard.';

  switch (action) {
    case 'create':
      return {
        action,
        credential,
        title: `Buat credential MQTT untuk device ${id}`,
        steps: [
          CONSOLE,
          'Klik "Add credentials" / "Create credential".',
          `Username: ${id}`,
          'Password: token device yang ditampilkan bersamaan dengan langkah ini (salin persis, termasuk awalan "bwn_").',
          ...permissionSteps,
          'Simpan.',
          done,
        ],
      };
    case 'update_password':
      return {
        action,
        credential,
        title: `Ganti password credential MQTT device ${id}`,
        steps: [
          CONSOLE,
          `Cari credential dengan username ${id}. Bila ada, hapus lalu buat ulang (HiveMQ Cloud tidak selalu menyediakan edit password).`,
          `Buat credential: username ${id}, password = token baru yang ditampilkan bersamaan dengan langkah ini.`,
          ...permissionSteps,
          'Flash ulang firmware dengan token baru; token lama tidak berlaku lagi.',
          done,
        ],
      };
    case 'disable':
      return {
        action,
        credential,
        title: `Nonaktifkan device ${id} di broker`,
        steps: [
          CONSOLE,
          `Hapus credential dengan username ${id} (HiveMQ Cloud tidak memiliki status nonaktif).`,
          'Sampai langkah ini dilakukan, data dari device tetap diabaikan oleh sistem karena device nonaktif.',
          done,
        ],
      };
    case 'enable':
      return {
        action,
        credential,
        title: `Aktifkan kembali device ${id}`,
        steps: [
          'Credential lama sudah dihapus saat device dinonaktifkan, dan sistem tidak menyimpan token aslinya.',
          'Lakukan "Rotasi token" pada device ini, lalu ikuti langkah pembuatan credential yang ditampilkan.',
        ],
      };
    case 'delete':
      return {
        action,
        credential,
        title: `Hapus credential MQTT device ${id}`,
        steps: [CONSOLE, `Hapus credential dengan username ${id}.`],
      };
  }
}

export function manualProvisioner(): BrokerProvisioner {
  return {
    provider: 'manual',
    createDevice: async (id) => ({ synced: false, setup: setup(id, 'create') }),
    setPassword: async (id) => ({ synced: false, setup: setup(id, 'update_password') }),
    setEnabled: async (id, enabled) => ({ synced: false, setup: setup(id, enabled ? 'enable' : 'disable') }),
    deleteDevice: async (id) => ({ synced: false, setup: setup(id, 'delete') }),
    listDevices: async () => null,
    close: async () => {},
  };
}
