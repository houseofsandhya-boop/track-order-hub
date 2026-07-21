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
  const latestStatus = useMemo(() => getLatestStatus(state.data?.order, shipments), [state.data]);

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
              : latestStatus || 'Your order is being prepared for shipment.'}
          </s-text>
        </s-stack>

        {shipments.length > 0 ? (
          shipments.map((shipment) => (
            <ShipmentCard key={shipment.id} shipment={shipment} />
          ))
        ) : (
          <s-box padding="base" border="base" borderRadius="base">
            <s-stack direction="block" gap="small-200">
              <s-badge tone="info">Preparing</s-badge>
              <s-text>Tracking details will appear here once the order is shipped.</s-text>
            </s-stack>
          </s-box>
        )}
      </s-stack>
    </s-section>
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
                  {item.company || 'Courier'} {item.number ? `- ${item.number}` : ''}
                </s-text>
                {item.url ? (
                  <s-link href={item.url} target="_blank">
                    Open courier tracking
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

function getLatestStatus(order, shipments) {
  if (order?.cancelledAt) return `This order was cancelled on ${formatDate(order.cancelledAt)}.`;
  if (shipments.some((shipment) => shipment.deliveredAt)) return 'At least one shipment has been delivered.';
  if (shipments.some((shipment) => shipment.inTransitAt)) return 'Your shipment is in transit.';
  if (shipments.length > 0) return 'Your order has shipment updates.';
  return '';
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
