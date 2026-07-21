/** @jsxImportSource preact */
import '@shopify/ui-extensions/preact';
import {render} from 'preact';
import {useEffect, useMemo, useState} from 'preact/hooks';

const API_ENDPOINT = 'https://track-order-hub-production.up.railway.app/api/order-tracking';

export default async () => {
  render(<OrderTrackingBlock />, document.body);
};

function OrderTrackingBlock() {
  const order = shopify.order.value;
  const [state, setState] = useState({status: 'loading'});

  useEffect(() => {
    let active = true;

    async function loadTracking() {
      if (!order?.id) {
        setState({status: 'empty', message: 'Order details are still loading.'});
        return;
      }

      try {
        const sessionToken = await shopify.sessionToken.get();
        const response = await fetch(API_ENDPOINT, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${sessionToken}`,
          },
          body: JSON.stringify({
            orderId: order.id,
            orderName: order.name,
          }),
        });

        const data = await response.json();

        if (!active) return;

        if (!response.ok || !data.ok) {
          setState({
            status: 'error',
            message: data.error || 'Tracking is not available for this order yet.',
          });
          return;
        }

        setState({status: 'ready', data});
      } catch (error) {
        if (!active) return;
        setState({
          status: 'error',
          message: 'Tracking is temporarily unavailable. Please check again later.',
        });
      }
    }

    loadTracking();

    return () => {
      active = false;
    };
  }, [order?.id]);

  const shipments = state.data?.shipments || [];
  const hasTracking = shipments.some((shipment) => shipment.tracking?.length);
  const timeline = useMemo(() => buildTimeline(state.data?.order, shipments), [state.data]);

  if (state.status === 'loading') {
    return (
      <s-section>
        <s-stack direction="block" gap="small-200">
          <s-heading>Track order</s-heading>
          <s-text color="subdued">Checking the latest shipping update...</s-text>
        </s-stack>
      </s-section>
    );
  }

  if (state.status === 'error' || state.status === 'empty') {
    return (
      <s-section>
        <s-stack direction="block" gap="small-200">
          <s-heading>Track order</s-heading>
          <s-banner tone={state.status === 'error' ? 'warning' : 'info'}>
            {state.message}
          </s-banner>
        </s-stack>
      </s-section>
    );
  }

  return (
    <s-section>
      <s-stack direction="block" gap="base">
        <s-stack direction="block" gap="small-200">
          <s-heading>Track order</s-heading>
          <s-text color="subdued">
            {hasTracking
              ? 'Your courier tracking details are available below.'
              : 'Your order is being prepared for shipment.'}
          </s-text>
        </s-stack>

        <s-box padding="base" border="base" borderRadius="base">
          <s-stack direction="block" gap="base">
            <s-stack direction="inline" gap="small-200" inlineAlignment="space-between">
              <s-text type="strong">Order progress</s-text>
              {state.data?.order?.name ? <s-text color="subdued">Status for {state.data.order.name}</s-text> : null}
            </s-stack>

            {timeline.map((item) => (
              <TimelineStep key={item.title} item={item} />
            ))}
          </s-stack>
        </s-box>

        {shipments.length > 0 ? (
          <s-stack direction="block" gap="small-300">
            <s-text type="strong">Shipment details</s-text>
            {shipments.map((shipment) => (
              <ShipmentCard key={shipment.id} shipment={shipment} />
            ))}
          </s-stack>
        ) : null}
      </s-stack>
    </s-section>
  );
}

function TimelineStep({item}) {
  const url = trackingUrl(item.tracking);

  return (
    <s-box padding="base" border="base" borderRadius="base">
      <s-stack direction="block" gap="small-100">
        <s-stack direction="inline" gap="small-200" inlineAlignment="space-between">
          <s-text type="strong">{item.title}</s-text>
          <s-badge tone={toneForTimelineState(item.state)}>{item.marker}</s-badge>
        </s-stack>
        <s-text>{item.text}</s-text>
        {item.detail ? <s-text color="subdued">{item.detail}</s-text> : null}
        {item.date ? <s-text color="subdued">{formatDateTime(item.date)}</s-text> : null}
        {item.updates?.length ? <PreparationUpdates item={item} /> : null}
        {url ? (
          <s-link href={url} target="_blank">
            {trackingLinkLabel(url)}
          </s-link>
        ) : null}
      </s-stack>
    </s-box>
  );
}

function PreparationUpdates({item}) {
  return (
    <s-details defaultOpen={item.state === 'active'}>
      <s-summary>{item.summaryLabel || `${item.updates.length} preparation updates available`}</s-summary>
      <s-stack direction="block" gap="small-300">
        {item.updates.map((update, index) => (
          <s-box key={`${update.date}-${index}`} padding="small-200" border="base" borderRadius="base">
            <s-stack direction="block" gap="small-100">
              <s-text>{update.text}</s-text>
              <s-text color="subdued">{formatDateTime(update.date)}</s-text>
            </s-stack>
          </s-box>
        ))}
      </s-stack>
    </s-details>
  );
}

function ShipmentCard({shipment}) {
  const status = shipment.displayStatus || shipment.status || 'Shipment update';
  const tracking = shipment.tracking || [];

  return (
    <s-box padding="base" border="base" borderRadius="base">
      <s-stack direction="block" gap="small-300">
        <s-stack direction="inline" gap="small-200" inlineAlignment="space-between">
          <s-text type="strong">{shipment.name || 'Shipment'}</s-text>
          <s-badge tone={toneForStatus(status)}>{formatStatus(status)}</s-badge>
        </s-stack>

        <s-stack direction="block" gap="small-200">
          {shipment.createdAt ? (
            <s-text color="subdued">Fulfilled on {formatDate(shipment.createdAt)}</s-text>
          ) : null}
          {shipment.inTransitAt ? (
            <s-text color="subdued">In transit since {formatDate(shipment.inTransitAt)}</s-text>
          ) : null}
          {shipment.deliveredAt ? (
            <s-text color="subdued">Delivered on {formatDate(shipment.deliveredAt)}</s-text>
          ) : null}
          {shipment.estimatedDeliveryAt ? (
            <s-text color="subdued">Estimated delivery {formatDate(shipment.estimatedDeliveryAt)}</s-text>
          ) : null}
        </s-stack>

        {tracking.length > 0 ? (
          <s-stack direction="block" gap="small-200">
            <s-divider />
            {tracking.map((item, index) => (
              <s-stack direction="block" gap="small-100" key={`${item.number}-${index}`}>
                <s-text type="strong">
                  {carrierName(item) || 'Courier'} {item.number ? `- ${item.number}` : ''}
                </s-text>
                {trackingUrl(item) ? (
                  <s-link href={trackingUrl(item)} target="_blank">
                    {trackingLinkLabel(trackingUrl(item))}
                  </s-link>
                ) : null}
              </s-stack>
            ))}
          </s-stack>
        ) : (
          <s-text color="subdued">Courier tracking will be added after dispatch.</s-text>
        )}
      </s-stack>
    </s-box>
  );
}

function buildTimeline(order, shipments) {
  const firstShipment = shipments[0];
  const firstTracking = shipments.flatMap((shipment) => shipment.tracking || []).find((item) => item.number || item.url);
  const shippedAt = firstShipment?.inTransitAt || firstShipment?.createdAt || '';
  const deliveredAt = shipments.find((shipment) => shipment.deliveredAt)?.deliveredAt || '';
  const estimatedAt = firstShipment?.estimatedDeliveryAt || '';
  const hasTracking = Boolean(firstTracking);
  const hasShipment = shipments.length > 0;
  const isDelivered =
    Boolean(deliveredAt) ||
    shipments.some((shipment) => String(shipment.displayStatus || shipment.status || '').toLowerCase().includes('delivered'));
  const preparationUpdates = buildPreparationUpdates(order?.processedAt, shippedAt);

  return [
    {
      title: 'Order confirmed',
      text: 'We have received your order and started processing it.',
      date: order?.processedAt,
      state: 'complete',
      marker: 'Complete',
    },
    {
      title: 'Preparing your order',
      text: 'Your item is being checked, packed, and prepared for shipment.',
      state: hasShipment ? 'complete' : 'active',
      marker: hasShipment ? 'Complete' : 'Current',
      updates: preparationUpdates,
      summaryLabel: `${preparationUpdates.length} preparation updates available`,
    },
    {
      title: hasTracking ? 'Shipped' : 'Tracking coming soon',
      text: hasTracking ? trackingLabel(firstTracking) : 'Courier tracking will be shared once fulfillment is complete.',
      detail: hasShipment && !hasTracking ? 'Your order has been fulfilled, but courier details are not available yet.' : '',
      date: shippedAt,
      state: hasTracking ? 'complete' : hasShipment ? 'active' : 'pending',
      marker: hasTracking ? 'Complete' : hasShipment ? 'Current' : 'Next',
      tracking: firstTracking,
    },
    {
      title: isDelivered ? 'Delivered' : 'Estimated delivery',
      text: isDelivered
        ? 'Delivered successfully.'
        : estimatedAt
          ? `Estimated delivery ${formatDate(estimatedAt)}.`
          : '18 to 20 days from the date of confirmation.',
      date: deliveredAt,
      state: isDelivered ? 'complete' : hasTracking ? 'active' : 'pending',
      marker: isDelivered ? 'Complete' : hasTracking ? 'Next' : 'Next',
    },
  ];
}

function buildPreparationUpdates(startValue, stopValue) {
  const startDate = parseDate(startValue);
  if (!startDate) return [];

  const stopDate = parseDate(stopValue) || new Date();
  const messages = [
    'Your item is being checked, packed, and prepared for shipment.',
    'Your order is moving through our quality check and packing process.',
    'Your package preparation is in progress and will be updated once it is shipped.',
  ];
  const updates = [];
  const twoDaysMs = 2 * 24 * 60 * 60 * 1000;

  for (let index = 0; index < messages.length; index += 1) {
    const updateDate = new Date(startDate.getTime() + index * twoDaysMs);
    if (updateDate.getTime() > stopDate.getTime()) break;

    updates.push({
      text: messages[index],
      date: updateDate.toISOString(),
    });
  }

  return updates;
}

function trackingLabel(tracking) {
  const company = carrierName(tracking) || 'Courier';
  const number = tracking?.number ? ` tracking number ${tracking.number}` : '';
  return `${company}${number}`;
}

function carrierName(tracking) {
  if (tracking?.url && /shiprocket/i.test(tracking.url)) return 'Shiprocket';
  if (tracking?.number && (!tracking?.company || /other/i.test(tracking.company))) return 'Shiprocket';
  return tracking?.company || '';
}

function trackingUrl(tracking) {
  if (tracking?.url) return tracking.url;
  if (tracking?.number && (!tracking?.company || /other/i.test(tracking.company))) {
    return `https://shiprocket.co/tracking/${encodeURIComponent(tracking.number)}`;
  }
  return '';
}

function trackingLinkLabel(url = '') {
  if (/shiprocket/i.test(url)) return 'Track live on Shiprocket';
  return 'Open courier tracking';
}

function toneForTimelineState(state = '') {
  if (state === 'complete') return 'success';
  if (state === 'active') return 'info';
  return 'auto';
}

function toneForStatus(status = '') {
  const normalized = status.toLowerCase();
  if (normalized.includes('delivered') || normalized.includes('success')) return 'success';
  if (normalized.includes('cancel') || normalized.includes('failure')) return 'critical';
  if (normalized.includes('transit') || normalized.includes('out')) return 'info';
  return 'auto';
}

function formatStatus(status = '') {
  return status
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatDate(value) {
  if (!value) return '';
  return new Date(value).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function formatDateTime(value) {
  if (!value) return '';
  return new Date(value).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function parseDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}
