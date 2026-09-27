import { StatusBar } from 'expo-status-bar';
import { useMemo, useState } from 'react';
import { SafeAreaView, Text, View, StyleSheet, Pressable } from 'react-native';
import { newUuidsV7 } from '@facilito/domain';
import { OutboxEngine } from './src/outbox';

const colors = {
  primary: '#0B7A45',
  accent: '#F47B20',
  mint: '#E4F6F2',
  ink: '#1B2838',
};

export default function App() {
  const outbox = useMemo(() => new OutboxEngine(), []);
  const [online, setOnline] = useState(true);
  const [pending, setPending] = useState(0);

  function enqueueSale() {
    outbox.enqueue({
      clientUuid: newUuidsV7(),
      type: 'sale',
      payload: { total: '150.00' },
      createdAt: new Date().toISOString(),
    });
    setPending(outbox.pendingCount());
  }

  function toggleOnline() {
    const next = !online;
    outbox.setOnline(next);
    setOnline(next);
  }

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar style="dark" />
      <Text style={styles.title}>Facilito POS</Text>
      <Text style={styles.byline}>by Logic Code Spot</Text>
      <View style={styles.banner}>
        <Text style={styles.bannerText}>
          {online ? 'En línea' : 'Sin conexión'} · Pendientes: {pending}
        </Text>
      </View>
      <Pressable style={styles.btn} onPress={enqueueSale}>
        <Text style={styles.btnText}>Registrar venta offline</Text>
      </Pressable>
      <Pressable style={[styles.btn, { backgroundColor: colors.accent }]} onPress={toggleOnline}>
        <Text style={styles.btnText}>Cambiar estado de red</Text>
      </Pressable>
      <Text style={styles.hint}>
        Los movimientos se sincronizan al volver la red. Los conflictos van a revisión humana.
      </Text>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.mint, padding: 16, gap: 12 },
  title: { fontSize: 28, fontWeight: '700', color: colors.primary },
  byline: { color: colors.ink, opacity: 0.7 },
  banner: {
    backgroundColor: '#fff',
    padding: 12,
    borderRadius: 12,
  },
  bannerText: { color: colors.ink, fontWeight: '600' },
  btn: {
    backgroundColor: colors.primary,
    padding: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  btnText: { color: '#fff', fontWeight: '700' },
  hint: { color: colors.ink, lineHeight: 20 },
});
