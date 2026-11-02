import { createWidget } from 'expo-widgets';
import {
  Circle,
  Divider,
  HStack,
  Image,
  Link,
  ProgressView,
  Spacer,
  Text,
  VStack,
  ZStack,
} from '@expo/ui/swift-ui';
import {
  accessibilityLabel,
  bold,
  containerBackground,
  font,
  foregroundStyle,
  frame,
  lineLimit,
  minimumScaleFactor,
  padding,
  privacySensitive,
  progressViewStyle,
  tint,
  widgetURL,
} from '@expo/ui/swift-ui/modifiers';
import { INITIAL_WIDGET_PROPS } from '../services/widgetSnapshotPresentation';

function AdloPulseLayout(props) {
  'widget';

  const accent = '#8987F2';
  const primary = { type: 'hierarchical', style: 'primary' };
  const secondary = { type: 'hierarchical', style: 'secondary' };
  const track = { type: 'hierarchical', style: 'quaternary' };
  const statusColor = props.paceTone === 'attention'
    ? '#FF7A86'
    : props.paceTone === 'caution'
      ? '#F4C15D'
      : props.paceTone === 'positive'
        ? '#67D2A0'
        : '#B8B6C9';
  const familyStatusColor = props.familyPaceTone === 'attention'
    ? '#FF7A86'
    : props.familyPaceTone === 'caution'
      ? '#F4C15D'
      : props.familyPaceTone === 'positive'
        ? '#67D2A0'
        : '#B8B6C9';

  return (
    <HStack
      spacing={12}
      modifiers={[
        padding({ horizontal: 2, vertical: 1 }),
        containerBackground({ type: 'material', material: 'regular' }, 'widget'),
        widgetURL('adlo://'),
      ]}
    >
      <VStack
        alignment="leading"
        spacing={5}
        modifiers={[
          frame({ minWidth: 205, idealWidth: 215, maxWidth: 228, alignment: 'leading' }),
          privacySensitive(),
        ]}
      >
        <HStack spacing={8}>
          <Text modifiers={[font({ textStyle: 'caption', weight: 'semibold' }), foregroundStyle(secondary), lineLimit(1), minimumScaleFactor(0.8)]}>
            {props.periodLabel.toUpperCase()}
          </Text>
          <Spacer />
          <Text modifiers={[font({ textStyle: 'caption2', weight: 'medium' }), foregroundStyle(secondary), lineLimit(1), minimumScaleFactor(0.75)]}>
            {props.reviewLabel}
          </Text>
        </HStack>

        <VStack alignment="leading" spacing={2}>
          <HStack>
            <Text modifiers={[font({ textStyle: 'caption2', weight: 'medium' }), foregroundStyle(primary)]}>
              You
            </Text>
            <Spacer />
            <Text modifiers={[font({ textStyle: 'caption2' }), foregroundStyle(statusColor), lineLimit(1)]}>{props.paceLabel}</Text>
          </HStack>
          <ProgressView
            value={props.spendingRatio}
            modifiers={[
              progressViewStyle('linear'),
              tint(statusColor),
              foregroundStyle(track),
              frame({ minWidth: 205, maxWidth: 228 }),
            ]}
          />
        </VStack>

        {props.hasFamilyBudget ? (
          <VStack alignment="leading" spacing={2}>
            <HStack>
              <Text modifiers={[font({ textStyle: 'caption2', weight: 'medium' }), foregroundStyle(primary)]}>
                Family
              </Text>
              <Spacer />
              <Text modifiers={[font({ textStyle: 'caption2' }), foregroundStyle(familyStatusColor), lineLimit(1)]}>{props.familyPaceLabel}</Text>
            </HStack>
            <ProgressView
              value={props.familySpendingRatio}
              modifiers={[
                progressViewStyle('linear'),
                tint(familyStatusColor),
                foregroundStyle(track),
                frame({ minWidth: 205, maxWidth: 228 }),
              ]}
            />
          </VStack>
        ) : null}

        <VStack alignment="leading" spacing={2}>
          <HStack>
            <Text modifiers={[font({ textStyle: 'caption2', weight: 'medium' }), foregroundStyle(primary)]}>
              Period elapsed
            </Text>
            <Spacer />
            <Text modifiers={[font({ textStyle: 'caption2' }), foregroundStyle(secondary)]}>Time</Text>
          </HStack>
          <ProgressView
            value={props.elapsedRatio}
            modifiers={[
              progressViewStyle('linear'),
              tint(accent),
              foregroundStyle(track),
              frame({ minWidth: 205, maxWidth: 228 }),
            ]}
          />
        </VStack>

      </VStack>

      <Divider />

      <Link
        destination="adlo://quick-add?source=widget"
        modifiers={[accessibilityLabel('Add an expense')]}
      >
        <VStack alignment="center" spacing={7} modifiers={[frame({ minWidth: 54, maxWidth: 62 })]}>
          <ZStack>
            <Circle modifiers={[foregroundStyle(accent), frame({ minWidth: 42, maxWidth: 42, minHeight: 42, maxHeight: 42 })]} />
            <Image systemName="plus" modifiers={[font({ size: 20, weight: 'semibold' }), foregroundStyle('#09090B')]} />
          </ZStack>
          <Text modifiers={[font({ textStyle: 'caption', weight: 'semibold' }), foregroundStyle(primary), bold()]}>Add</Text>
        </VStack>
      </Link>
    </HStack>
  );
}

export const AdloPulseWidget = createWidget(
  'AdloPulseWidget',
  AdloPulseLayout,
  INITIAL_WIDGET_PROPS
);
