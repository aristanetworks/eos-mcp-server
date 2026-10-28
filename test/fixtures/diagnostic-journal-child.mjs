import { openDiagnosticJournal } from '../../src/diagnostics/journal.ts';

const journal = openDiagnosticJournal(process.argv[2], 'inventory-identity');
journal.save({
  reservation_id: 'crash-reservation', inventory_hostname: 'leaf1', diagnostic: 'ping',
  state: 'active', reserved_at: new Date().toISOString()
});
console.log('READY');
setInterval(() => {}, 1000);
