/** Subscribe with a bearer header (never put session tokens in a URL). */
export function subscribeDayUpdates(url: string, token: string, onChange: () => void) {
  const controller = new AbortController();
  let retry: ReturnType<typeof setTimeout> | undefined;
  const connect = async () => {
    try {
      const response = await fetch(`${url}/day-events`, {
        headers: { Authorization: `Bearer ${token}` }, signal: controller.signal
      });
      if (response.status === 401 || response.status === 403) return;
      if (!response.ok || !response.body) throw new Error('Update stream unavailable');
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let pending = '';
      while (!controller.signal.aborted) {
        const { value, done } = await reader.read();
        if (done) break;
        pending += decoder.decode(value, { stream: true });
        let end;
        while ((end = pending.indexOf('\n\n')) !== -1) {
          const message = pending.slice(0, end); pending = pending.slice(end + 2);
          if (message.startsWith('data:')) onChange();
        }
      }
    } catch { /* Retry; normal data reads display actionable errors. */ }
    if (!controller.signal.aborted) retry = setTimeout(() => void connect(), 2000);
  };
  void connect();
  return () => { controller.abort(); clearTimeout(retry); };
}
